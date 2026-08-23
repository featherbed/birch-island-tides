# Birch Island Tides

Phone-first PWA for tidal predictions near **Birch Island, Harpswell, Maine** (Casco Bay). Open `index.html` in a browser (or serve the folder over HTTPS/`localhost` so “Add to Home Screen” and the service worker work). No build step.

## How to open

```bash
cd /workspace/birch-island-tides
python3 -m http.server 8080
```

Then visit `http://localhost:8080` on a phone (same network) or Safari. On iPhone: Share → **Add to Home Screen**.

Times are **America/New_York**. Heights are **feet, MLLW**.

## Station (assumption)

There is **no NOAA CO-OPS station on Birch Island, Harpswell / Casco Bay**. NOAA does list **8410875 Birch Islands** — that is **Whiting Bay** (Washington County, near Eastport), not this island.

This app uses the closest official prediction station to Harpswell’s Birch Island (CDP ~43.8200°N, 70.0067°W):

| Field | Value |
| --- | --- |
| **ID** | **8417553** |
| **Name** | Wilson Cove, Middle Bay, ME |
| **Lat / lon** | 43.8250°N, 69.9767°W |
| **Type** | Subordinate (reference: Portland **8418150**) |
| **Source** | [NOAA MDAPI tidepredictions](https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions) and [NOAA Tide Predictions](https://tidesandcurrents.noaa.gov/noaatidepredictions.html?id=8417553) |

Other nearby stations considered: South Harpswell / Potts Harbor **8417647** (~5.7 mi S) and South Freeport **8417801** (~4.8 mi W). Wilson Cove is ~1.5 miles east of Birch Island on Middle Bay.

Observed water level (shown only as a tooltip on the estimated height) comes from Portland **8418150** (43.6581°N, 70.2442°W) — the nearest NWLON gauge. Subordinate stations do not publish 6-minute prediction series; the 24-hour curve is a cosine interpolation between official high/low extrema.

## API

`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter`  
`product=predictions`, `interval=hilo`, `datum=MLLW`, `time_zone=lst_ldt`, `units=english`.

Attribution: NOAA / NOS / CO-OPS. No analytics, no accounts.

## Day lists (all tides)

Maine tides are semi-diurnal: a local calendar day usually has **four** highs/lows, sometimes **three** if one falls just after midnight. The app requests NOAA `interval=hilo` from the **previous local day through the following morning** (week view: through +8 days; month view: first−1 through last+1), then **buckets each prediction by the NOAA `lst_ldt` date stamp** (`YYYY-MM-DD` on `t`). That stamp is already America/New_York wall date, so early-morning and late-night extrema stay on the correct day and are never dropped.

Today and each “Next 7 days” block list **every** high and low on that date.

## Month view (horizon bars)

Below the week list, a **month** section (current month, ‹ › to change) draws one horizontal **horizon bar** per day: left edge is that day’s lowest low, right edge its highest high (the full tidal swing). All days share one x-scale from the month’s global min to max, so spring vs neap range is obvious. Small ticks mark the day’s other extrema; the number on the right is the range in feet. Today is highlighted.

A compact **moon glyph** sits on each row (same chart, not a separate calendar). Daily illumination uses Meeus *Astronomical Algorithms* ch. 48.4 (phase angle at local noon). New, first-quarter, full, and last-quarter instants use Meeus ch. 49 and are assigned to the **America/New_York** calendar day of that instant. New and full (spring tides) are ringed and slightly emphasized. Verified Aug 2026 against timeanddate / Almanac: last quarter **Aug 5** (02:21 UTC Aug 6), new **Aug 12** (17:36 UTC), first quarter **Aug 19** (02:46 UTC Aug 20), full **Aug 28** (04:18 UTC).

Data is NOAA hilo only (station 8417553 is subordinate and has no 6-minute series).
