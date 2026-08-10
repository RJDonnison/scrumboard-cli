# scrumboard-cli

CLI to log into, scrape, and sync the UC scrumboard into JSON for feeding into an AI.

It drives a real Chromium browser (via Playwright) using your logged-in session,
so it sees exactly what you'd see on the board.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/RJDonnison/scrumboard-cli/tasks/install.sh | bash
```

This clones the repo to `~/.scrumboard-cli/src`, installs dependencies,
downloads the Chromium build Playwright needs, and links the `scrumboard`
command onto your PATH. Re-run it any time to update to the latest version.

<details>
<summary>Manual install</summary>

```sh
git clone https://github.com/RJDonnison/scrumboard-cli.git
cd scrumboard-cli
npm install
npm run install-browser   # installs the Chromium build Playwright needs
npm link                  # adds the `scrumboard` command to your PATH
```

</details>

<details>
<summary>Arch / other unsupported Linux distros</summary>

Playwright only ships a bundled Chromium build for Ubuntu, Debian, macOS, and
Windows. On other distros (Arch, Fedora, etc.) `install.sh` skips that
download and instead looks for a Chromium/Chrome binary already on your
`PATH` (`chromium`, `chromium-browser`, `google-chrome`, `google-chrome-stable`).

If it finds one, it saves its path as `chromiumPath` in
`~/.scrumboard-cli/config.json` automatically, and the CLI will use it
instead of Playwright's bundled build. If it doesn't find one, install
Chromium first, e.g. on Arch:

```sh
sudo pacman -S chromium
```

then re-run the install script.

You can also set this yourself at any time, or point it at a different
Chromium install, by editing `~/.scrumboard-cli/config.json`:

```json
{ "chromiumPath": "/usr/bin/chromium" }
```

A `CHROMIUM_PATH` environment variable, if set, always takes priority over
this config value.

</details>

## Usage

### `scrumboard login`

Opens a browser window to the scrumboard login page and waits for you to
complete login (including any SSO/2FA). Once it detects a redirect away from
the login page, it saves your session to `~/.scrumboard-cli/session.json` for
later commands to reuse.

```sh
scrumboard login
```

### `scrumboard project [id]`

Gets or sets the active project ID, used to build the board URL for export.

```sh
scrumboard project 67      # set the active project
scrumboard project           # print the active project
```

> [!important]
> To find your project ID, open your project's board page. The URL will look something like `https://scrumboard.csse.canterbury.ac.nz/project/67/board` — the number before `/board` is the project ID.

### scrumboard chromium <path>

Sets the chromium path to use for Playwright. This is only needed on unsupported Linux distros (Arch, Fedora, etc.) where the install script can't download a bundled Chromium build.

```sh
scrumboard chromium /usr/bin/chromium
```

### `scrumboard export`

Logs into the active project's board with your saved session and scrapes it
to JSON.

```sh
scrumboard export
scrumboard export -d -o exports/board.json
scrumboard export --headed
```

| Flag               | Description                                                                                                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-d, --details`    | Also open each task's edit panel and each story's detail modal to scrape descriptions (and, for stories, acceptance criteria). Without this flag, tasks have no description and stories only include their name. |
| `-o, --out <path>` | Output location. A directory (auto-named `export-<timestamp>.json` inside it) or an exact path ending in `.json`. Falls back to `config.out`, then the current directory.                                        |
| `--headed`         | Run the browser with a visible window instead of headless (useful for debugging).                                                                                                                                |

The export includes:

- **tasks** — every task card on the sprint board, with title, priority,
  complexity, time tracking, assignees, reviewers, column status, and (with
  `--details`) its description.
- **stories** — every story, with its name (and, with `--details`, its
  description and acceptance criteria).

## Config

Config is stored at `~/.scrumboard-cli/config.json` and can hold:

- `projectId` — the active project, set via `scrumboard project <id>`.
- `out` — a default output path for `scrumboard export`. There's no CLI
  command for this yet — set it by editing `~/.scrumboard-cli/config.json`
  directly, e.g. `{ "out": "exports/board.json" }`.
- `chromiumPath` — path to a Chromium/Chrome binary to use instead of
  Playwright's bundled build. Set automatically by `install.sh` on
  unsupported Linux distros; can also be set manually. A `CHROMIUM_PATH`
  environment variable overrides this if set.

## Requirements

- Node.js >= 18
- A UC scrumboard account
