# Compliance Watch

Daily dashboard for tracking expired and soon-to-expire permits across Safe Harbor Marinas properties.

**Live at:** https://ncustis.github.io/compliance-watch/ (once GitHub Pages is enabled)

## What this is

A static dashboard that:

- Reads a daily CSV export from Origami Risk
- Joins against a property reference (RVP, region mapping)
- Shows portfolio-wide compliance, regional standings, per-property breakdowns
- Surfaces permits flagged as "needs help" for leadership attention
- Preserves an archive of resolved permits with the notes that explained them

The dashboard itself is static HTML/CSS/JS. Notes that users write live in a separate Azure Function backend (Azure Table Storage), so they persist across users and devices.

## Repo structure

```
├── index.html                          # The dashboard
├── assets/
│   ├── css/styles.css                  # All styling
│   └── js/dashboard.js                 # All client-side logic
├── data/
│   └── dashboard_data.json             # Generated daily by refresh.py
├── raw/
│   └── permits_YYYY-MM-DD.csv          # Origami exports land here
├── scripts/
│   ├── refresh.py                      # CSV → JSON pipeline
│   └── property_reference.csv          # Property code → RVP/Region mapping
└── .github/workflows/
    └── refresh.yml                     # Runs refresh.py on new CSV commits
```

## Daily refresh pipeline

```
Origami emails CSV → Power Automate saves to OneDrive → Office Script 
posts to GitHub raw/ → GitHub Action triggers refresh.py → 
dashboard_data.json updated → GitHub Pages serves new data
```

The Office Script and Power Automate flow set up the automated push.
Manual fallback: drop a new CSV into `raw/` via the GitHub UI; the Action runs automatically.

## Managing the property reference

If a property is added, renamed, or moves between RVPs, edit `scripts/property_reference.csv` directly and push the change. The next refresh picks it up.

## Local testing

```bash
python3 scripts/refresh.py    # Regenerates data/dashboard_data.json from newest raw/*.csv
python3 -m http.server 8000   # Serve the dashboard locally at http://localhost:8000
```

## Future enhancements

- [ ] Archive auto-population (move resolved permits to archive_permits)
- [ ] Daily history snapshot (real month-over-month trends)
- [ ] Note attribution (who wrote which note)
- [ ] Migration to private hosting once IT provisions a path
