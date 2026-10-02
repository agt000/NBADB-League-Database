# NBADB League Database

A SillyTavern extension for the **NBA Manager 2001** character card — providing a full NBA league database with 29 teams, 407+ players, six-attribute ratings, contracts, draft picks, trade search, season simulation, and more.

## Features

- **29-Team NBA Database**: All 2001-02 opening day rosters with realistic contracts
- **Six-Attribute System**: Inside Offense, Inside Defense, Outside Offense, Outside Defense, Playmaking, Mental (all 0-50)
- **Contract Management**: Remaining years, player/team options, salary totals, luxury tax tracking
- **Free Agent Pool**: Real 2001 free agents, auto-populated on contract expiry
- **Trade Search Engine**: Bidirectional (offer/want), with tier requirements and NBA rule compliance checks
- **Dynamic Draft Picks**: Value adjusted by team record, future outlook, draft class strength
- **Draft Lottery**: Record-weighted probabilities matching real NBA odds
- **Team Future Assessment**: 1-5 star rating based on young core, cap space, contracts
- **Retirement System**: Age + durability based with probabilistic outcomes
- **Durability & Injury Proneness**: 0-100 ratings affecting trade value and career longevity
- **Game Simulation Engine**: Regular season (20-game blocks) and playoff key-moment checks
- **Server-Side Mirroring**: Automatic database backup to SillyTavern settings for crash recovery
- **Excel-Style Tables**: Sort, filter, and search all data with summary rows

## Requirements

- [SillyTavern](https://github.com/SillyTavern/SillyTavern) v1.18.0+
- Character card: `NBA Manager 2001` (sold separately... just kidding, it's in this repo's `card/` folder)
- World book: `NBA Manager 2001 World Book` (also in `card/` folder)

## Installation

### Via Git (recommended)

```bash
cd SillyTavern/data/<your-username>/extensions/
git clone https://github.com/agt000/NBADB-League-Database.git NBADB
```

Or for all users:
```bash
cd SillyTavern/scripts/extensions/third-party/
git clone https://github.com/agt000/NBADB-League-Database.git NBADB
```

### Manual

1. Download this repository as ZIP
2. Extract the `NBADB` folder to `SillyTavern/data/<your-username>/extensions/`
3. Refresh SillyTavern (Ctrl+F5)

### Setup Character Card & World Book

1. Import `card/NBA经理2001.png` as a character card
2. Import `card/NBA经理2001世界书v1.json` as a world book (do NOT embed in card)
3. Start a chat with the character

## Quick Start

1. Open **Extensions Settings** → **NBADB 联盟数据库**
2. Follow the 4-step setup:
   - **① Get Link Code** — generates a 64-character connection code
   - **② Verify** — send `NBADB验证 <code>` in chat, paste the returned verification code into the panel
   - **③ Import Data & Create Profile** — auto-scans `data/` directory, then fill in manager name/team/background
   - **④ Start Game** — runs a write test, then auto-triggers the opening conversation

## Usage

Once set up, the plugin automatically:
- Injects a full league snapshot before each AI generation (60KB budget)
- Pre-rolls d20 dice for checks and injury simulation
- Collects `<nbadb-settlement>` tags from AI responses (with quietPrompt fallback)
- Processes `<nbadb-league>` tags for season-end 29-team updates
- Decrements contract years, processes retirements, updates free agents

### Console API

```javascript
NBADB.db()                    // Get full database
NBADB.standings()             // League standings + draft positions + future outlook
NBADB.lottery(seed)           // Simulate draft lottery
NBADB.tradeSearch({want: ['Tim Duncan']})  // Reverse trade search
NBADB.tradeSearch({offer: ['Player A', '2002 1st Round Pick']})  // Forward search
NBADB.future('Lakers')        // Team future assessment
NBADB.pickValue('2003 1st Round Pick')  // Dynamic pick value
NBADB.export()                // Export database as JSON
NBADB.open('roster')          // Open manager panel at specific tab
```

## Data Structure

| Collection | Key | Description |
|---|---|---|
| manager | field | Manager profile (name, team, trust, fame) |
| team | field | Team state (record, chemistry, payroll) |
| players | name | All players with six attributes + contracts |
| freeAgents | name | Available free agents |
| assets | name | Draft picks, exceptions, cash |
| programs | name | Training programs (injury recovery, potential) |
| events | eventId | Game history log |
| league | team | 29 teams with needs, standings, future outlook |
| prospects | name | Future draft classes (2002-2021) |
| rules | id | NBA rules with effective years |

## Trade Value Tiers

| Tier | Value | Count | Trade Requirement |
|---|---|---|---|
| Superstar | 120+ | 2-4 | ≥1 All-NBA (95+) or ≥2 All-Stars (82+) |
| All-NBA | 95-119 | ~9 | ≥1 All-Star (82+) |
| All-Star | 82-94 | ~25 | ≥1 Near All-Star (65+) |
| Near All-Star | 65-81 | ~31 | None |
| Starter | 38-64 | ~49 | None |
| Bench | 15-37 | ~107 | None |
| Fringe | <15 | ~112 | None |
| Garbage Contract | Negative | ~18 | Must attach assets to dump |

## File Structure

```
NBADB/
├── manifest.json          # Extension manifest
├── index.js               # Main entry (ST integration layer)
├── core.js                # Pure logic (no ST dependencies, testable)
├── style.css              # UI styles (#FF6100 orange theme)
├── README.md              # This file
├── data/
│   ├── league_2001.json   # 407 players, 29 teams, 12 FA, 18 rules
│   ├── prospects_pool.json # 238 prospects (2002-2021 drafts)
│   └── index.json         # File hashes for integrity checking
└── test/
    ├── core.test.mjs      # 117 unit tests
    ├── integration.test.mjs # 35 integration tests
    └── panel.test.mjs     # 24 panel smoke tests
```

## Testing

```bash
cd NBADB
node test/core.test.mjs
node test/integration.test.mjs
node test/panel.test.mjs
```

## Official Documentation Compliance

This extension follows the [SillyTavern Extension Writing Guide](https://docs.sillytavern.app/for-contributors/writing-extensions/):

- ✅ manifest.json with all required fields
- ✅ generate_interceptor with proper 4-parameter signature
- ✅ Lifecycle hooks (activate, disable, delete, clean)
- ✅ CSS loaded via manifest
- ✅ Uses getContext() for all ST API access
- ✅ SillyTavern.libs.localforage for storage
- ✅ extensionSettings + saveSettingsDebounced for persistence
- ✅ chatMetadata + saveMetadata for chat binding
- ✅ eventSource.on with proper cleanup in dispose()
- ✅ Popup API instead of native prompts
- ✅ toastr for notifications
- ✅ No server plugin dependency
- ✅ Complete README with installation and usage
- ✅ Open source (AGPL-3.0)

## License

This project is licensed under the **AGPL-3.0 License** — see [LICENSE](LICENSE) for details.

## Acknowledgments

- [SillyTavern](https://github.com/SillyTavern/SillyTavern) for the amazing platform
- The NBA 2001-02 season for endless nostalgia
