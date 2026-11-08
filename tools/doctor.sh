#!/bin/sh
# Read-only health checks for a running install: the stack, the bucket, the
# router, every site, disk and backups. Changes nothing (celld diagnose runs
# with --read-only), so it is safe on production.
#
#   tools/doctor.sh
#   CELLD_COMPOSE_DIR=../celld-sites-deploy tools/doctor.sh
#
# Exit status: 0 when nothing failed, 1 when a check did. Warnings do not fail.
set -u
project="${CELLD_COMPOSE_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
backup_dir="${CELLD_BACKUP_DIR:-$project/backups}"
backup_max_days="${DOCTOR_BACKUP_MAX_DAYS:-7}"
failed=0
warned=0

ok() { printf 'ok    %s\n' "$*"; }
warn() { warned=$((warned + 1)); printf 'warn  %s\n' "$*"; }
bad() { failed=$((failed + 1)); printf 'FAIL  %s\n' "$*"; }
dc() { docker compose --project-directory "$project" "$@"; }

# In the celld container: celld and curl are there, and so are the bucket
# credentials and the admin token, so nothing secret crosses argv or the host.
in_celld() { dc exec -T celld sh -c "$1"; }

usage() {
	echo "usage: tools/doctor.sh" >&2
	exit 2
}
[ $# -eq 0 ] || usage

# --- stack --------------------------------------------------------------------
running=$(dc ps --services --filter status=running 2>/dev/null || true)
if printf '%s\n' "$running" | grep -qx celld; then
	ok "the celld container is running"
else
	bad "the celld container is not running (docker compose --project-directory '$project' up -d)"
fi
if printf '%s\n' "$running" | grep -qx s3; then
	ok "the s3 container is running"
else
	bad "the s3 container is not running"
fi
# Every container this project created should be up; a crashed optional profile
# (store, hamstr, dashboard, demo) is still worth knowing about.
all=$(dc ps -a --format '{{.Name}} {{.State}}' 2>/dev/null || true)
if [ -n "$all" ]; then
	stopped=$(printf '%s\n' "$all" | awk '$2 != "running" { print $1 " (" $2 ")" }')
	if [ -n "$stopped" ]; then
		old_ifs="$IFS"
		IFS='
'
		for name in $stopped; do bad "container $name is not running"; done
		IFS="$old_ifs"
	else
		ok "every container is running"
	fi
fi

# --- bucket -------------------------------------------------------------------
if printf '%s\n' "$running" | grep -qx celld; then
	if diagnose=$(in_celld 'celld diagnose --read-only --listen 127.0.0.1:0 --bucket "$CELLD_BUCKET" --endpoint "$S3_ENDPOINT" --region "${AWS_REGION:-us-east-1}"' 2>&1); then
		ok "the bucket answers celld diagnose --read-only"
	else
		bad "celld diagnose failed:"
		printf '%s\n' "$diagnose" | tail -5 | sed 's/^/      /'
	fi
fi

# --- router and sites ---------------------------------------------------------
overview=""
if printf '%s\n' "$running" | grep -qx celld; then
	overview=$(in_celld '
		umask 077
		f=$(mktemp)
		printf "header = \"Authorization: Bearer %s\"\n" "$ADMIN_TOKEN" > "$f"
		listen="${CELLD_LISTEN:-0.0.0.0:8080}"
		curl -sSf -K "$f" -H "Host: $ADMIN_HOST" "http://127.0.0.1:${listen##*:}/__admin/overview"
		rc=$?
		rm -f "$f"
		exit $rc
	' 2>&1) || overview=""
fi
if [ -z "$overview" ]; then
	bad "the router admin API did not answer"
else
	sites=$(printf '%s' "$overview" | grep -o '"id":"[^"]*"' | sed 's/^"id":"//;s/"$//')
	count=$(printf '%s\n' "$sites" | grep -c . || true)
	if [ "$count" -eq 0 ]; then
		warn "the router serves no sites"
	else
		ok "the router answers ($count site(s))"
		# One exec for every site: the container's network, no host round trips.
		results=$(printf '%s\n' "$sites" | dc exec -T celld sh -c '
			listen="${CELLD_LISTEN:-0.0.0.0:8080}"
			while IFS= read -r host; do
				[ -n "$host" ] || continue
				code=$(curl -sS -o /dev/null -m 10 -w "%{http_code}" -H "Host: $host" "http://127.0.0.1:${listen##*:}/" 2>/dev/null || echo 000)
				printf "%s %s\n" "$host" "$code"
			done
		' 2>/dev/null || true)
		down=$(printf '%s\n' "$results" | awk '$2 == "000" || $2 ~ /^5/ { print $1 " (" $2 ")" }')
		if [ -z "$down" ]; then
			ok "all $count sites answer below 500"
		else
			old_ifs="$IFS"
			IFS='
'
			for entry in $down; do bad "site $entry"; done
			IFS="$old_ifs"
			bad "$(printf '%s\n' "$down" | grep -c .) of $count sites are down"
		fi
	fi
fi

# --- disk ---------------------------------------------------------------------
free_kb=$(df -Pk "$project" 2>/dev/null | awk 'NR == 2 { print $4 }')
if [ -n "${free_kb:-}" ]; then
	if [ "$free_kb" -lt 524288 ]; then
		bad "less than 512 MB free on the install's filesystem"
	elif [ "$free_kb" -lt 2097152 ]; then
		warn "$((free_kb / 1024)) MB free on the install's filesystem"
	else
		ok "$((free_kb / 1024 / 1024)) GB free on the install's filesystem"
	fi
else
	warn "could not read free space for $project"
fi

# --- backups ------------------------------------------------------------------
if [ -d "$backup_dir" ]; then
	newest=$(find "$backup_dir" -maxdepth 1 -type f -name '*.tgz' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -n 1 | cut -d' ' -f2-)
	if [ -z "$newest" ]; then
		warn "no backup archive in $backup_dir (tools/update.sh writes one)"
	else
		age_days=$((($(date +%s) - $(date -r "$newest" +%s)) / 86400))
		if [ "$age_days" -gt "$backup_max_days" ]; then
			warn "the newest backup is $age_days days old ($newest)"
		else
			ok "the newest backup is $age_days day(s) old"
		fi
	fi
else
	warn "no backup directory at $backup_dir"
fi

# --- summary ------------------------------------------------------------------
echo
if [ "$failed" -gt 0 ]; then
	echo "doctor: $failed failed, $warned warning(s)"
	exit 1
fi
echo "doctor: healthy, $warned warning(s)"
exit 0
