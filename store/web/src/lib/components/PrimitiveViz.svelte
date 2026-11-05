<script lang="ts">
	import "./primitive-viz.css";
</script>

<div class="pn-visual">
      <!-- ══════════════════ the heavy way ══════════════════ -->
      <section class="pn-half pn-half--heavy" aria-label="The usual way: one always-on container and database per tool">
        <svg class="pn-svg" viewBox="0 0 500 600" role="img" aria-labelledby="pn-heavy-title pn-heavy-desc">
          <title id="pn-heavy-title">The usual way</title>
          <desc id="pn-heavy-desc">
            Three tools, each with an app container wired to a large, always-running database stack.
            All three databases stay lit and reserved while idle, and the memory gauge reads ninety percent.
          </desc>

          <rect width="500" height="600" fill="url(#pn-heavy-bg)" />
          <ellipse class="pn-ambient pn-ambient--heavy" cx="250" cy="315" rx="230" ry="160" />

          <!-- permanent app → database wiring -->
          <g class="pn-heavy-link">
            <path d="M98 208V254" /><path d="M250 208V254" /><path d="M402 208V254" />
            <path class="pn-heavy-link__head" d="M92 246l6 8 6-8" />
            <path class="pn-heavy-link__head" d="M244 246l6 8 6-8" />
            <path class="pn-heavy-link__head" d="M396 246l6 8 6-8" />
          </g>

          <!-- request impact rings -->
          <rect class="pn-ping pn-ping--photos" x="38" y="90" width="124" height="124" rx="28" />
          <rect class="pn-ping pn-ping--invoices" x="340" y="90" width="124" height="124" rx="28" />

          <!-- apps: always lit -->
          <g class="pn-app pn-app--heavy pn-app--a" transform="translate(42 96)">
            <rect class="pn-app__box" width="112" height="112" rx="22" />
            <use href="#pn-icon-notes" transform="translate(56 56)" class="pn-icon" />
          </g>
          <g class="pn-app pn-app--heavy pn-app--b" transform="translate(194 96)">
            <rect class="pn-app__box" width="112" height="112" rx="22" />
            <use href="#pn-icon-photos" transform="translate(56 56)" class="pn-icon" />
          </g>
          <g class="pn-app pn-app--heavy pn-app--c" transform="translate(346 96)">
            <rect class="pn-app__box" width="112" height="112" rx="22" />
            <use href="#pn-icon-invoices" transform="translate(56 56)" class="pn-icon" />
          </g>

          <!-- database flash rings -->
          <rect class="pn-db-flash pn-db-flash--photos" x="180" y="236" width="140" height="258" rx="30" />
          <rect class="pn-db-flash pn-db-flash--invoices" x="332" y="236" width="140" height="258" rx="30" />

          <!-- heavy database stacks: always warm -->
          <g class="pn-stack pn-stack--a" transform="translate(98 264)">
            <use href="#pn-postgres" />
            <g class="pn-leds pn-leds--a">
              <circle cx="24" cy="56" r="2.4" /><circle cx="34" cy="55" r="2.4" /><circle cx="43" cy="52" r="2.4" />
            </g>
          </g>
          <g class="pn-stack pn-stack--b" transform="translate(250 264)">
            <use href="#pn-postgres" />
            <g class="pn-leds pn-leds--b">
              <circle cx="24" cy="56" r="2.4" /><circle cx="34" cy="55" r="2.4" /><circle cx="43" cy="52" r="2.4" />
            </g>
          </g>
          <g class="pn-stack pn-stack--c" transform="translate(402 264)">
            <use href="#pn-postgres" />
            <g class="pn-leds pn-leds--c">
              <circle cx="24" cy="56" r="2.4" /><circle cx="34" cy="55" r="2.4" /><circle cx="43" cy="52" r="2.4" />
            </g>
          </g>

          <!-- query packets on the wire -->
          <circle class="pn-query pn-query--photos" cx="250" cy="208" r="3.5" />
          <circle class="pn-query pn-query--invoices" cx="402" cy="208" r="3.5" />

          <!-- requests -->
          <circle class="pn-req-halo pn-req-halo--photos" cx="250" cy="14" r="16" />
          <circle class="pn-req pn-req--photos" cx="250" cy="14" r="7" />
          <circle class="pn-req-halo pn-req-halo--invoices" cx="402" cy="14" r="16" />
          <circle class="pn-req pn-req--invoices" cx="402" cy="14" r="7" />

          <!-- memory gauge -->
          <g class="pn-gauge" transform="translate(36 556)">
            <use href="#pn-ram" transform="translate(0 -6) scale(0.68)" class="pn-gauge__chip pn-gauge__chip--heavy" />
            <rect class="pn-gauge__track" x="72" y="0" width="348" height="24" rx="12" />
            <rect class="pn-gauge__fill pn-gauge__fill--heavy" x="76" y="4" width="313" height="16" rx="8" />
            <text class="pn-gauge__value pn-gauge__value--heavy" x="452" y="18" text-anchor="end">90%</text>
          </g>
        </svg>
      </section>

      <!-- ══════════════════ the new primitive ══════════════════ -->
      <section class="pn-half pn-half--light" aria-label="The new primitive: one runtime, apps asleep with their databases on disk">
        <svg class="pn-svg" viewBox="0 0 500 600" role="img" aria-labelledby="pn-light-title pn-light-desc">
          <title id="pn-light-title">The new primitive</title>
          <desc id="pn-light-desc">
            Three apps share one runtime. Their SQLite databases rest in a tray on disk. A request wakes
            one app: its database rises from the tray into the app, the pair glows, the write is saved,
            then the database slides back down and the app sleeps again.
          </desc>

          <rect width="500" height="600" fill="url(#pn-light-bg)" />
          <ellipse class="pn-ambient pn-ambient--light" cx="250" cy="300" rx="220" ry="200" />

          <!-- disk tray -->
          <g class="pn-tray" transform="translate(30 398)">
            <rect class="pn-tray__box" width="440" height="132" rx="24" />
            <path class="pn-tray__shelf" d="M2 47 H22 L38 75 H402 L418 47 H438 V119 A12 12 0 0 1 426 130 H14 A12 12 0 0 1 2 119 Z" />
            <rect class="pn-dock" x="32" y="86" width="88" height="14" rx="7" />
            <rect class="pn-dock" x="178" y="86" width="88" height="14" rx="7" />
            <rect class="pn-dock" x="324" y="86" width="88" height="14" rx="7" />
            <g class="pn-drive" transform="translate(236 108)">
              <rect width="28" height="13" rx="3" />
              <path d="M4 4.5h20" />
              <circle cx="22" cy="9" r="1.5" />
            </g>
          </g>

          <!-- runtime -->
          <rect class="pn-runtime" x="30" y="80" width="440" height="180" rx="26" />

          <!-- dashed travel lines -->
          <g class="pn-conn">
            <path class="pn-conn__base" d="M104 228V488" />
            <path class="pn-conn__base" d="M250 228V488" />
            <path class="pn-conn__base" d="M396 228V488" />
          </g>

          <!-- asleep slots -->
          <g class="pn-slot pn-slot--notes" transform="translate(52 110)">
            <rect class="pn-slot__box" width="104" height="118" rx="20" />
            <use href="#pn-icon-notes" transform="translate(52 36) scale(0.8)" class="pn-icon pn-icon--dim" />
          </g>
          <g class="pn-slot pn-slot--photos" transform="translate(198 110)">
            <rect class="pn-slot__box" width="104" height="118" rx="20" />
            <use href="#pn-icon-photos" transform="translate(52 36) scale(0.8)" class="pn-icon pn-icon--dim" />
          </g>
          <g class="pn-slot pn-slot--invoices" transform="translate(344 110)">
            <rect class="pn-slot__box" width="104" height="118" rx="20" />
            <use href="#pn-icon-invoices" transform="translate(52 36) scale(0.8)" class="pn-icon pn-icon--dim" />
          </g>

          <!-- databases resting in the tray -->
          <g class="pn-dock-db pn-dock-db--notes" transform="translate(104 456)">
            <use href="#pn-sqlite-off" />
          </g>
          <g class="pn-dock-db pn-dock-db--photos" transform="translate(250 456)">
            <use href="#pn-sqlite-off" />
          </g>
          <g class="pn-dock-db pn-dock-db--invoices" transform="translate(396 456)">
            <use href="#pn-sqlite-off" />
          </g>

          <!-- saved ripples -->
          <ellipse class="pn-ripple pn-ripple--photos" cx="250" cy="488" rx="46" ry="11" />
          <ellipse class="pn-ripple pn-ripple--invoices" cx="396" cy="488" rx="46" ry="11" />

          <!-- ── wake overlay: photos ── -->
          <g class="pn-wake pn-wake--photos">
            <path class="pn-beam" d="M218 462 H282 L268 234 H232 Z" />
            <path class="pn-conn__on" d="M250 228V488" />
            <rect class="pn-slot__box-on" x="198" y="110" width="104" height="118" rx="20" />
            <use href="#pn-icon-photos" transform="translate(250 146) scale(0.8)" class="pn-icon pn-icon--lit" />
            <path class="pn-write" d="M250 174V182" />
            <path class="pn-write__head" d="M245 178l5 6 5-6" />
            <g class="pn-rise pn-rise--photos">
              <use href="#pn-sqlite-on" transform="translate(250 456)" />
            </g>
          </g>

          <!-- ── wake overlay: invoices ── -->
          <g class="pn-wake pn-wake--invoices">
            <path class="pn-beam" d="M364 462 H428 L414 234 H378 Z" />
            <path class="pn-conn__on" d="M396 228V488" />
            <rect class="pn-slot__box-on" x="344" y="110" width="104" height="118" rx="20" />
            <use href="#pn-icon-invoices" transform="translate(396 146) scale(0.8)" class="pn-icon pn-icon--lit" />
            <path class="pn-write" d="M396 174V182" />
            <path class="pn-write__head" d="M391 178l5 6 5-6" />
            <g class="pn-rise pn-rise--invoices">
              <use href="#pn-sqlite-on" transform="translate(396 456)" />
            </g>
          </g>

          <!-- requests -->
          <circle class="pn-req-halo pn-req-halo--photos" cx="250" cy="14" r="16" />
          <circle class="pn-req pn-req--photos" cx="250" cy="14" r="7" />
          <circle class="pn-req-halo pn-req-halo--invoices" cx="396" cy="14" r="16" />
          <circle class="pn-req pn-req--invoices" cx="396" cy="14" r="7" />

          <!-- memory gauge -->
          <g class="pn-gauge" transform="translate(36 556)">
            <use href="#pn-ram" transform="translate(0 -6) scale(0.68)" class="pn-gauge__chip pn-gauge__chip--light" />
            <rect class="pn-gauge__track" x="72" y="0" width="348" height="24" rx="12" />
            <rect class="pn-gauge__fill pn-gauge__fill--light" x="76" y="4" width="17" height="16" rx="8" />
            <text class="pn-gauge__value pn-gauge__value--light pn-value--idle" x="452" y="18" text-anchor="end">5%</text>
            <text class="pn-gauge__value pn-gauge__value--light pn-value--busy" x="452" y="18" text-anchor="end">18%</text>
          </g>
        </svg>
      </section>
    </div>

<svg class="pn-defs" aria-hidden="true" focusable="false">
    <defs>
      <radialGradient id="pn-heavy-bg" cx="50%" cy="35%" r="80%">
        <stop offset="0" stop-color="#fffdfb" />
        <stop offset="0.55" stop-color="#fdf5f0" />
        <stop offset="1" stop-color="#fbeae1" />
      </radialGradient>
      <radialGradient id="pn-light-bg" cx="50%" cy="40%" r="82%">
        <stop offset="0" stop-color="#fcfdfb" />
        <stop offset="0.55" stop-color="#f6f9f2" />
        <stop offset="1" stop-color="#edf3e8" />
      </radialGradient>

      <linearGradient id="pn-heavy-gauge" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#c8431d" />
        <stop offset="0.6" stop-color="#d96a43" />
        <stop offset="1" stop-color="#e08a68" />
      </linearGradient>
      <linearGradient id="pn-light-gauge" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#a9bf9a" />
        <stop offset="1" stop-color="#7d966c" />
      </linearGradient>

      <linearGradient id="pn-pg-body" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#fdf3ee" />
        <stop offset="0.35" stop-color="#f7e3da" />
        <stop offset="0.7" stop-color="#fbe9e1" />
        <stop offset="1" stop-color="#f3d6c8" />
      </linearGradient>
      <linearGradient id="pn-pg-top" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#e8b49c" />
        <stop offset="1" stop-color="#d99a7e" />
      </linearGradient>
      <linearGradient id="pn-beam" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stop-color="#7d966c" stop-opacity="0.05" />
        <stop offset="0.55" stop-color="#7d966c" stop-opacity="0.2" />
        <stop offset="1" stop-color="#7d966c" stop-opacity="0" />
      </linearGradient>

      <!-- notes -->
      <g id="pn-icon-notes">
        <path d="M-22 -30 H8 L22 -16 V26 A6 6 0 0 1 16 32 H-22 A6 6 0 0 1 -28 26 V-24 A6 6 0 0 1 -22 -30 Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" />
        <path d="M8 -30 V-16 H22" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" />
        <path d="M-16 -6 H14 M-16 4 H14 M-16 14 H6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
      </g>

      <!-- photos -->
      <g id="pn-icon-photos">
        <rect x="-30" y="-26" width="60" height="52" rx="8" fill="none" stroke="currentColor" stroke-width="3" />
        <circle cx="13" cy="-10" r="5" fill="currentColor" />
        <path d="M-26 18 L-8 -2 L8 12 L16 3 L27 17" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
      </g>

      <!-- invoices -->
      <g id="pn-icon-invoices">
        <path d="M-22 -30 H22 A4 4 0 0 1 26 -26 V30 L18 23 L10 30 L2 23 L-6 30 L-14 23 L-22 30 V-26 A4 4 0 0 1 -22 -30 Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" />
        <path d="M-14 -17 H0 M-14 -6 H14 M-14 5 H14 M-14 16 H2" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
      </g>

      <!-- heavy three-tier database -->
      <g id="pn-postgres">
        <path d="M-56,190 V228 C-56,242 56,242 56,228 V190 C56,204 -56,204 -56,190 Z" fill="url(#pn-pg-body)" stroke="#c8431d" stroke-width="1.5" />
        <path d="M-56,150 V188 C-56,202 56,202 56,188 V150 C56,164 -56,164 -56,150 Z" fill="url(#pn-pg-body)" stroke="#c8431d" stroke-width="1.5" />
        <path d="M-56,110 V148 C-56,162 56,162 56,148 V110 C56,124 -56,124 -56,110 Z" fill="url(#pn-pg-body)" stroke="#c8431d" stroke-width="1.5" />
        <path d="M-56,70 V108 C-56,122 56,122 56,108 V70 C56,84 -56,84 -56,70 Z" fill="url(#pn-pg-body)" stroke="#c8431d" stroke-width="1.5" />
        <path d="M-56,30 V68 C-56,82 56,82 56,68 V30 C56,44 -56,44 -56,30 Z" fill="url(#pn-pg-body)" stroke="#c8431d" stroke-width="1.5" />
        <path d="M-56,-10 V28 C-56,42 56,42 56,28 V-10 C56,4 -56,4 -56,-10 Z" fill="url(#pn-pg-body)" stroke="#c8431d" stroke-width="1.5" />
        <ellipse cx="0" cy="-10" rx="56" ry="14" fill="url(#pn-pg-top)" stroke="#c8431d" stroke-width="1.8" />
        <ellipse cx="0" cy="-10" rx="40" ry="8" fill="#fff8f4" stroke="#c8431d" stroke-opacity="0.45" stroke-width="1.4" />
        <g fill="#c8431d" opacity="0.75">
          <circle cx="24" cy="56" r="2.5" /><circle cx="34" cy="55" r="2.5" /><circle cx="43" cy="52" r="2.5" />
          <circle cx="24" cy="136" r="2.5" /><circle cx="34" cy="135" r="2.5" /><circle cx="43" cy="132" r="2.5" />
          <circle cx="24" cy="216" r="2.5" /><circle cx="34" cy="215" r="2.5" /><circle cx="43" cy="212" r="2.5" />
        </g>
      </g>

      <!-- sleeping SQLite, centred on x=0 -->
      <g id="pn-sqlite-off">
        <path d="M-32,0 V24 C-32,33 32,33 32,24 V0 Z" fill="#fbfbf8" stroke="#8f928c" stroke-width="1.8" stroke-dasharray="5 4" />
        <ellipse cx="0" cy="0" rx="32" ry="8.5" fill="#f1f2ee" stroke="#8f928c" stroke-width="1.8" stroke-dasharray="5 4" />
        <rect x="-11" y="26" width="22" height="5" rx="2.5" fill="#8f928c" />
      </g>

      <!-- awake SQLite, centred on x=0 -->
      <g id="pn-sqlite-on">
        <path d="M-30,0 V22 C-30,31 30,31 30,22 V0 Z" fill="#eef5ea" stroke="#7d966c" stroke-width="1.8" />
        <ellipse cx="0" cy="0" rx="30" ry="8" fill="#dfe9d8" stroke="#5f7a50" stroke-width="1.8" />
        <rect x="-10" y="24" width="20" height="4" rx="2" fill="#7d966c" />
      </g>

      <!-- ram chip -->
      <g id="pn-ram">
        <path d="M-14-28v8M0-28v8M14-28v8M-14 20v8M0 20v8M14 20v8M-32-10h8M-32 0h8M-32 10h8M24-10h8M24 0h8M24 10h8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
        <rect x="-24" y="-20" width="48" height="40" rx="5" fill="#ffffff" stroke="currentColor" stroke-width="2.4" />
        <rect x="-16" y="-12" width="32" height="24" rx="2" fill="none" stroke="currentColor" stroke-width="1" stroke-opacity="0.5" />
      </g>
    </defs>
  </svg>
