# foundry-mcp-server

MCP server for [Foundry VTT](https://foundryvtt.com/) v13. Connects directly via Socket.IO — no Foundry module installation required.

## Features

- **Direct connection** to Foundry VTT via Socket.IO with HTTP session authentication
- **45 MCP tools** for document CRUD, embedded documents, chat, dice rolling, file management, macro execution, compendium access, scene management, combat workflow, game state control, presentation, admin, and convenience operations
- **9 MCP resources** for browsing world data (actors, journals, scenes, items, macros, playlists, roll tables, combats, cards)
- **System-agnostic** — works with any game system (PF1e, PF2e, D&D 5e, etc.)
- **Automatic reconnection** with retry logic on timeout/disconnect

## Setup

### Prerequisites

- Node.js 18+
- Foundry VTT v13 with an active world
- A Foundry user with Gamemaster role

### Install

```bash
git clone https://github.com/JoeLuker/foundry-mcp-server.git
cd foundry-mcp-server
npm install
npm run build
```

### Find your Foundry User ID

Open your Foundry VTT world, open the browser console (F12), and run:

```js
game.users.contents.map(u => ({ name: u.name, id: u.id, role: u.role }))
```

Copy the `id` of the Gamemaster user.

### Configure in Claude Code

Add to `~/.claude/settings.json` (or project `.mcp.json`):

```json
{
  "mcpServers": {
    "foundry-vtt": {
      "command": "node",
      "args": ["/path/to/foundry-mcp-server/dist/index.js"],
      "env": {
        "FOUNDRY_URL": "http://localhost:30000",
        "FOUNDRY_USER_ID": "your-user-id-here",
        "FOUNDRY_PASSWORD": ""
      }
    }
  }
}
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FOUNDRY_USER_ID` | Yes | — | The `_id` of a Foundry user with GM role |
| `FOUNDRY_URL` | No | `http://localhost:30000` | Foundry VTT server URL |
| `FOUNDRY_PASSWORD` | No | `""` | User password (if set) |

## Tools

### World

| Tool | Description |
|------|-------------|
| `foundry_get_status` | Connection status, world info, version, system |

### Documents

| Tool | Description |
|------|-------------|
| `foundry_list_documents` | List documents by type with field selection and pagination |
| `foundry_get_document` | Get a single document by ID |
| `foundry_search_documents` | Search by name pattern and field filters |
| `foundry_create_document` | Create a new document |
| `foundry_update_document` | Update with partial data (dot-notation supported) |
| `foundry_delete_document` | Delete a document |
| `foundry_create_document_batch` | Batch create (max 100) |
| `foundry_update_document_batch` | Batch update (max 100) |
| `foundry_delete_document_batch` | Batch delete (max 100) |

**Document types:** Actor, Adventure, Cards, ChatMessage, Combat, FogExploration, Folder, Item, JournalEntry, Macro, Playlist, RollTable, Scene, Setting, User

### Embedded Documents

| Tool | Description |
|------|-------------|
| `foundry_list_embedded` | List embedded docs within a parent |
| `foundry_create_embedded` | Add an embedded doc to a parent |
| `foundry_update_embedded` | Update an embedded doc |
| `foundry_delete_embedded` | Delete an embedded doc |
| `foundry_create_embedded_batch` | Batch create (max 100) |
| `foundry_update_embedded_batch` | Batch update (max 100) |
| `foundry_delete_embedded_batch` | Batch delete (max 100) |

**Embedded types:** ActiveEffect, ActorDelta, AmbientLight, AmbientSound, Card, Combatant, CombatantGroup, Drawing, Item, JournalEntryPage, MeasuredTemplate, Note, PlaylistSound, Region, RegionBehavior, TableResult, Tile, Token, Wall

### Chat & Dice

| Tool | Description |
|------|-------------|
| `foundry_send_chat` | Send a chat message (supports HTML, whispers, IC/OOC) |
| `foundry_roll_dice` | Roll dice using Foundry's dice engine |

### File Uploads

| Tool | Description |
|------|-------------|
| `foundry_upload_file` | Upload files via base64 or local path |

### Macros

| Tool | Description |
|------|-------------|
| `foundry_execute_macro` | Execute JavaScript in Foundry's server context |

### Compendiums

| Tool | Description |
|------|-------------|
| `foundry_list_compendium_packs` | List available compendium packs |
| `foundry_get_compendium_index` | Get pack index (lightweight listing) |
| `foundry_get_compendium_entry` | Get a full entry from a pack |
| `foundry_search_compendium` | Search pack entries by name/filters |
| `foundry_import_from_compendium` | Import an entry from a pack into the world |

### Scene Management

| Tool | Description |
|------|-------------|
| `foundry_activate_scene` | Activate a scene for all players |
| `foundry_place_token` | Place an actor's token on a scene at x,y |
| `foundry_preload_scene` | Pre-cache scene assets on all connected clients |
| `foundry_pull_to_scene` | Force a player's view to a specific scene |
| `foundry_reset_fog` | Clear fog of war exploration data for a scene |

### Combat

| Tool | Description |
|------|-------------|
| `foundry_roll_initiative` | Roll initiative for combatants (all or specific) |
| `foundry_advance_combat` | Navigate turns/rounds (next/previous) |
| `foundry_control_combat` | Start or end a combat encounter |

### Game State

| Tool | Description |
|------|-------------|
| `foundry_toggle_pause` | Pause or unpause the game |
| `foundry_control_playlist` | Play/stop playlists or individual sounds |
| `foundry_list_online_users` | List currently connected users |

### Presentation

| Tool | Description |
|------|-------------|
| `foundry_show_journal` | Display a journal entry popup to players |
| `foundry_share_image` | Share an image popup with players |

### Admin & Files

| Tool | Description |
|------|-------------|
| `foundry_browse_files` | Browse files and directories in Foundry's data storage |
| `foundry_create_directory` | Create a directory in Foundry's data storage |
| `foundry_manage_compendium` | Create, delete, or migrate world compendium packs |
| `foundry_get_world_size` | Get disk usage info for world collections and packs |

### Convenience

| Tool | Description |
|------|-------------|
| `foundry_create_journal` | Create a journal entry with pages in one call |
| `foundry_modify_actor_hp` | Apply damage/healing to an actor's HP |

> **Note:** The `foundry_execute_macro` tool requires a connected browser client to execute JavaScript in Foundry's game context. All other tools communicate directly via Socket.IO and work without a browser.

## Development

```bash
npm run dev    # Run with tsx (auto-compiles TypeScript)
npm run build  # Compile to dist/
npm start      # Run compiled version
```

## License

MIT
