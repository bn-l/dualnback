# List the recipes.
default:
    @just --list

# Install dependencies and the Chromium build the end-to-end tests use.
install:
    npm install
    npx playwright install chromium

# Start the app at http://localhost:5173.
dev:
    npx vp dev

# Build for production into dist/.
build:
    npx vp build

# Serve the production build, with the same cross-origin isolation headers as dev.
preview: build
    npx vp preview

# The production build on workerd, as Cloudflare serves it (http://localhost:8787).
serve: build
    npx wrangler dev

# Build, check everything, then upload dist/ to nback.bn-l.net (wrangler.jsonc).
deploy: build all
    npx wrangler deploy

# Lint and type check: oxlint and tsc for TS, ESLint (eslint-cssicorn) for CSS.
check:
    npx vp check --no-fmt
    npx eslint

# Unit tests. Pass a file or filter to narrow them: `just test rating`.
test *args:
    npx vp test run {{ args }}

# End-to-end tests in Chromium. One plays a full real round, so expect about a minute.
e2e *args:
    npx playwright test {{ args }}

# Everything that should pass before a commit.
all: check test e2e

# Regenerate the spoken letters in public/sounds with a macOS voice: `just sounds Karen`.
sounds voice="Samantha":
    #!/usr/bin/env bash
    set -euo pipefail
    work=$(mktemp -d)
    for letter in c h k l q r s t; do
        # Lowercase on purpose: an uppercase letter is read as "capital C".
        say -v "{{ voice }}" -o "$work/$letter.aiff" "$letter"
        afconvert -f WAVE -d LEI16@44100 -c 1 "$work/$letter.aiff" "public/sounds/$letter.wav"
    done
    trash "$work"
    ls -l public/sounds

# Redraw public/og.png, the link preview image, from scripts/og-image.html.
og:
    node scripts/og-image.ts

# Redraw docs/hero.svg, the animation at the top of the README, from scripts/readme-hero.ts.
# jiti because the script imports the app's own modules, which leave off the .ts.
hero:
    npx jiti scripts/readme-hero.ts

# Remove build and test output.
clean:
    trash dist test-results playwright-report 2>/dev/null || true
