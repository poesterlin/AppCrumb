# An app store for little tools you own

**Reader:** you have built a small web app with an AI assistant and have run
Docker Compose at least once.

I want a little tool to scale to zero. It is used briefly and then sits idle
for months. SaaS charges you for the idle months. Self-hosting charges you a
container and a database for the idle months. An idle app should cost nothing
but disk, and wake when you open it.

That is the promise of Hamstr. A tool you open once a year should not hold a
process open all year. A box with a hundred tiny apps should be plausible.

I think small SaaS has the user's deal backwards. You pay rent for software
that could be a file. You give up your data for a tool that could run on your
box. You accept an account for a utility that should need no account at all.
The alternative is a catalog of code and a runtime on the user's machine.

Self-hosted Workers and Durable Objects make that practical.
[celld](https://github.com/denoland/celld) runs Workers and Durable Objects on
one node. Each app instance gets an isolate, a separate JavaScript heap. Each
Durable Object (a named server object) gets SQLite. An idle app can be shed,
and the next request wakes it. That is how many tiny apps fit on one small box
without a container each.

The runtime is no longer the hard part. Security and UX are.

## The user's deal with small SaaS is bad

Most hosted tools want an account before they do anything. Your data sits on a
stranger's server. The free tier has ads or a limit, and the service can
disappear.

Self-hosting swaps that for a different tax. Twenty little tools often become
twenty containers, twenty runtimes and twenty update paths. Most of them idle
all year.

Sending a zip file is not much better. Someone has to run it, and everyone ends
up with a separate copy of the data.

The missing layer is distribution. We need to hand someone a small tool as
software, not as a service.

## What the user gains

- **Idle apps cost disk, not RAM.** An app that nobody opens is shed. The next
  request wakes it. The same box can hold many small tools.
- **No account per tool.** You sign in to the platform once. Apps receive your
  identity from the platform, so they do not need their own login, password
  reset or user table.
- **Your data stays with you.** Each app keeps its data in SQLite on your
  machine. You can copy the volume, download a backup, or export an app's data.
- **Code you can inspect.** An app is a folder with a manifest and either a
  server module, static files, or both. The installed code is readable. If the
  publisher ships source, you can rebuild it or ask an AI to change it.
- **Sharing without hosting.** A publisher uploads a bundle once. Everyone who
  installs it runs it on their own machine. The publisher pays nothing for
  other people's usage.
- **A real URL and a real database.** Each app gets its own origin and its own
  SQLite databases. It is a web app, not a desktop app or a zip file.
- **Few permissions to understand.** An app can ask for network hosts, and for
  a browser device such as the microphone. With no allowlist, its server cannot
  make a request. You see the hosts before it runs.

## What it costs

The benefits only count if the hard parts are solved. Security and UX are the
two blockers. Trust and operations are the next layer.

### Security

The isolate limits what an app can reach. It does not contain a bug in celld,
V8 or the router. Every site on a node shares one process, one heap and one
disk. Hostile-app sandboxing is a goal, not a claim; the
[security model](https://github.com/poesterlin/AppCrumb/blob/main/docs/SECURITY.md)
explains what is missing. For code you do not trust, the only real separation
today is a separate node with its own bucket and process.

There are smaller holes too. Apps have no per-app secrets, so an app that needs
an API key has nowhere safe to keep it. The data is stored in plaintext. If you
share a node, the person running it can read every app's data. Browser code is
held to its declared hosts for connections and form posts, but a link can still
navigate away.

### UX

Installing an app is close. Running the box is not. Naming, certificates,
backups, updates and recovery still ask for a terminal or a compose file. A
phone app store sets the bar. We are not there.

### Trust and open gaps

A SHA-256 proves the bundle arrived intact. It does not prove who published it.
Signing is next. Moderation reduces the chance that a bad app is listed. It is
not containment.

You are the operator. You own the disk, the backups, the updates and the
monitoring. One app can fill the disk because bytes are not quota'd. celld is
alpha; the formats will change. I have no cold-start number, and I will not
quote one until I measure it. The catalog is a prototype, and I have not opened
a public instance to browse.

Some apps do not fit yet. This platform has no WebSockets and no alarms; the
[site contract](https://github.com/poesterlin/AppCrumb/blob/main/docs/SITES.md)
lists the gaps. Apps poll or refresh. That is fine for a Secret Santa draw and
wrong for a collaborative whiteboard.

None of this makes an app safe to run. It is the list I want to shrink.

## What the user should be able to expect

This is the standard I am working toward:

- Install an app in one click, from a catalog, without a terminal.
- Give it a name and a certificate without reading a DNS manual.
- Let it store data without choosing a database.
- Back it up, restore it and remove it from the same screen.
- See exactly what it can reach before it runs.
- Keep the app when the publisher disappears.
- Run a stranger's app without trusting the stranger to keep it online.

Those are product requirements, not features. If the platform cannot meet them,
the local app store stays a hobby.

## What I have built

Hamstr is the shell. celld is the runtime underneath. AppCrumb is the catalog.
An app is a folder. A crumb is one thing you make with an app: one draw, one
board, one list. Each crumb is its own site with its own SQLite databases.

The current prototype, in a 2026-11-01 run on a development VM (10 vCPU, 8 GB
node limit), installed an app in 230 ms and created a crumb in 65 ms. A proxied
request cost about 1.5 ms more than a direct celld request. Those numbers are
why I think the model can work: many tiny apps, no container each.

The prototypes are ordinary: a Secret Santa draw, a training log, a whiteboard.
Each is too small for a container and too personal for a login.

## What I want next

Security first. Signing, per-app storage quotas, and a real hostile-app
sandbox. Until the runtime can contain deliberate attacks, one node per trust
tier is the current answer.

UX second. One-click install with a name, a certificate and a backup. Updates
that do not need a terminal. Removal that asks before it deletes data.

Then source-first installs, so you can build an app in a disposable container
with no network, read it, change it, and then run it. Then federation and a
signed catalog feed.

The apps I want next are small:

- a Brutto-Netto calculator (German gross-to-net salary) that keeps your
  salary history in SQLite;
- a PDF merger and redactor for contracts and payslips;
- an invoice generator with a local client list;
- a medication or migraine log with a chart for the doctor;
- a subscription tracker for notice periods and monthly cost.

The Brutto-Netto calculator is the clearest test. An app with no declared
network hosts and no admin grant cannot make a server request. In Hamstr, its
page cannot post the form to another origin either. A link can still navigate
away; the browser policy does not cover navigation. What the platform can
promise is that the stored data stays on your machine and the server has no
route out.

That is the standard I care about: would you put your salary, your family's
names, or your medical data into it?

## Try it

The code is at
[github.com/poesterlin/AppCrumb](https://github.com/poesterlin/AppCrumb). The
[manual](https://github.com/poesterlin/AppCrumb/tree/main/docs-site) covers the
current install paths. That includes a single-container appliance for amd64 and
arm64, and a Home Assistant add-on.

Read the
[security model](https://github.com/poesterlin/AppCrumb/blob/main/docs/SECURITY.md)
before you install an app you did not write. It lists what is isolated and what
is not.

The idea does not depend on today's code. A little tool should be as easy to
install as an app, and as private as a folder.
