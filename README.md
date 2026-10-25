# monday.com Issue Provider for Super Productivity

Community [issue-provider plugin](https://github.com/super-productivity/super-productivity/blob/master/docs/add-new-integration.md) that connects a monday.com board to [Super Productivity](https://super-productivity.com/).

## Features

- Search board items by name
- Import / refresh items as tasks
- Auto-import open items to the backlog
- Comments from item updates
- Done detection from the status column (`is_done`)
- Notes ↔ monday item description (sync direction configurable; default off)
- Create items and rename (title sync)
- Account-subdomain links (e.g. `https://your-slug.monday.com/…`)
- Optional “assigned to me” filter

Notes sync lands in the task **Notes** field only (not repeated in the monday integration panel).

## monday.com API

- Create a token: profile picture → **Developers** → **API token**
- Free / Basic / Standard accounts have a **daily API call limit** (on the order of hundreds to ~1,000 calls/day depending on plan). Pro/Enterprise have higher limits. An optional API add-on exists only if you exceed those limits.
- A free [developer sandbox](https://developer.monday.com/api-reference/docs/developer-sandbox) is available for testing with higher complexity budgets.

For personal use with Super Productivity’s default poll interval (10 minutes), a Free/Standard account is usually fine.

## Install

1. Build a ZIP: `npm run package` → `release/sp-monday-1.0.0.zip`
2. In Super Productivity: **Settings → Plugins → Choose Plugin File** and pick the ZIP
3. Enable the plugin, then add a **monday.com** issue provider and paste your API token

Once listed in the app’s Community Plugins catalog, desktop users can install from **Settings → Plugins** in one click.

## Develop

```bash
npm install
npm run check          # typecheck + test + build
npm run package        # dist/ + release ZIP
```

Requires Node 20+.

## Configure

| Field | Description |
| --- | --- |
| Personal API Token | Required. From monday.com Developers → API token |
| Board | Required. Loaded after the token is set |
| Only items assigned to me | Filters the people column with `assigned_to_me` |
| People column ID | Advanced. Default `person` — change if your board uses another id |
| Filter username | Advanced. Ignores your own updates when detecting remote changes |

## License

MIT
