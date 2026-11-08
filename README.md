<p align="center">
  <img src="https://github.com/user-attachments/assets/689fb067-a674-4e23-8212-01bb261eaf2a" alt="Bottleneck" />
</p>

> "AI substantially increases code output but has smaller effects on final software output … Code review becomes the bottleneck."
>
> Chen and Stratton, 2026 [[1]](#references)

<img src="https://github.com/user-attachments/assets/528b205e-8566-4ee4-9129-686119ea7f2d" alt="Bottleneck">

## Features

- :mag: Review an agent's changes like a pull request
- :speech_balloon: Comment on hunks or files and send to an agent
- :left_speech_bubble: Talk it through with the agent, under the code
- :warning: Rank files by risk and review the riskiest first
- :repeat: See only what changed since your last review
- :white_check_mark: Stage, discard, commit and push as you go
- :twisted_rightwards_arrows: Open pull requests with agent-drafted descriptions
- :thinking: Ask the agent to explain its changes
- :art: Syntax highlighting with [delta](https://github.com/dandavison/delta)
- :keyboard: lazygit-style keys

## Why

We are the bottleneck [[1]](#references). Agents write code faster than we can review it. But that doesn't mean we should stop reviewing [[2]](#references).

Reviewing usually means juggling `git diff`, an editor and your agent's chat, sending comments as you go. Comments and fixes become a merry-go-round, and every round you review the whole diff again. Then you have to work out what the agent changed, and whether it addressed your comments at all.

Bottleneck puts the diff, your comments, the agent and git in one place. Comments go to the agent with the corresponding code. Connect your agents through Bottleneck's MCP server and the conversation comes back to you: the agent answers each comment under the code. It flags the places it's unsure about. It ranks the files by risk, so you start where it matters. Each round shows only what changed since the last. Staging hunks turns the diff into a to-do list.

## Install

Ask your agent in Herdr:

```
Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/olimorris/herdr-bottleneck
```

Or run the install script:

```sh
git clone https://github.com/olimorris/herdr-bottleneck
cd herdr-bottleneck
./install.sh
```

It copies the mod into Herdr, binds `cmd-shift-r` unless that key is taken, and checks the mod loads. To update, `git pull` and run it again.

Agents answer your comments and rank the diff through Bottleneck's MCP server. Bottleneck offers to set it up the first time you need it. Setup installs the server's packages, adds it to Claude Code and shows the config for any other agent. From a clone, `./install.sh --mcp` does the same, and later updates keep it set up.

Needs `git`. Optional: `delta` for syntax highlighting, [gh](https://cli.github.com) for pull requests, Node.js 18 for the MCP server.

## Usage

Press `cmd-shift-r` in your agent's tab. A Code review tab opens in the same space and refreshes as files change.

### Views

- **Uncommitted**: everything since the last commit, untracked files included
- **vs main**: everything since the branch left `main`
- **Since review**: only what changed since you last sent comments

### Keys

| Key | Action |
| --- | --- |
| `h` / `l` | Previous / next view |
| `j` / `k` | Next / previous hunk |
| `J` / `K` | Next / previous file |
| `c` | Comment on hunk |
| `f` | Comment on file |
| `x` | Delete comment, or close a conversation |
| `s` | Send comments |
| `space` | Stage hunk |
| `shift-space` | Stage file |
| `d` / `D` | Discard hunk / file |
| `C` | Commit |
| `P` | Push |
| `z` | Fold file |
| `v` | Mark file viewed |
| `e` | Agent explains the diff |
| `a` | Ask about hunk |
| `r` | Reply to the agent |
| `+` / `-` | More / less context |
| `/` | Search; `n` / `N` for next / previous match |
| `?` | Show or hide key hints |

Dialogs confirm with `cmd-enter` and close with `esc`.

### Sending comments

<img src="https://github.com/user-attachments/assets/1a9d445e-3040-48c5-a681-76f90c7b929f" alt="Send comments">

`s` opens the send dialog. Pick the agent, then one of the options:

1. **Paste**: into the agent's input, so you can add context
2. **Send**: paste and press Enter for you
3. **Markdown file**: `.git/bottleneck.md`, path copied. Comments clear when the file is deleted. Without the MCP server only, since there's no one to answer in Bottleneck

Comments are kept per repo until sent. If the agent rewrites a commented hunk, the comment is marked outdated and still sent.

### Talking to the agent

Needs the MCP server. Each comment you send becomes a conversation under its hunk, like a GitHub review thread. The agent answers there, saying what it changed or why it didn't. Press `r` to reply in place. Your reply goes straight to the agent, and you can watch the fix land in the diff. `x` closes the conversation, and staging the hunk folds it away.

The agent can start conversations too. As it works, it flags places it's unsure about or guessed at, on the line in question, so you know where to look first.

### Ranking by risk

Needs the MCP server. Click the risk icon above the file list and an agent ranks every file in the view by how risky it is to get wrong. The list then runs riskiest first, each file with its risk and a one-line reason. You can pick a running agent or start a new one in its own tab. A new one ranks without defending choices it made. The list icon switches back to path order, and the refresh icon ranks again after the agent has changed more.

### Staging

In Uncommitted, `space` stages a hunk and `shift-space` a file. A fully staged file moves into a **Staged** section under the file list, and to the end of the diff, folded. `j` and `k` skip it, so you only step through what's left. Unstage it with its "−" button or `shift-space` to bring it back.

### Customising

Bottleneck follows what you've already set:

- **Colours**: your Herdr theme
- **Font and size**: your terminal's
- **Syntax colours**: delta's, e.g. `git config --global delta.syntax-theme Dracula` (`delta --list-syntax-themes` lists them)

To change the size of the code, create `~/.config/herdr-app/bottleneck.json`:

```json
{ "font_size": 16 }
```

To open it with a different key, change `cmd-shift-r` in `~/.config/herdr-app/keys.json`:

```json
{ "global": { "cmd-shift-r": "mod.open:Bottleneck" } }
```

### Limits

- This computer only, not remote spaces
- Up to 300 files and 3,000 lines per file
- Renames show as a delete and an add

## Tests

```sh
npm test
```

Needs Node 22 and git. Each test runs the mod's git code against a throwaway repo in your temp folder. They also run on every push and pull request, on Linux and macOS.

## References

1. Chen, Fiona, and James Stratton. "Artificial Intelligence in the Firm: Bottlenecks in Software Production." Job Market Paper, August 4, 2026. https://fion.ac/jellyfish.pdf.
2. Beer, Jenay M., Arthur D. Fisk, and Wendy A. Rogers. "Toward a Framework for Levels of Robot Autonomy in Human-Robot Interaction." *Journal of Human-Robot Interaction* 3, no. 2 (2014): 74. https://doi.org/10.5898/JHRI.3.2.Beer.

## Licence

MIT. File type icons from [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme), also MIT.

[RECIPE.md](RECIPE.md) is the brief to build this mod from scratch.
