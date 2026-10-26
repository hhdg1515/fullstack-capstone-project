# Curated U.S. metro directory

## Source and compatibility

`giftlink-backend/data/us-regions.json` is the only runtime directory. Version
`us-census-2021-curated-v2` expands 12 to **50 metros across 41 states plus DC**.
All 50 states and DC remain selectable, including states without curated metros.
It is a selection of major metros, not nationwide city coverage or a verification
of a user's address. Territories, micropolitan areas and other metros are outside
this initial selection. Alaska/Hawaii and interior/Southern regions are included,
not only coastal population centers.

Keep the existing vintage: **2021 Census metro geography / 2022 state labels**.
Source: official [Census CitySDK metro file](https://github.com/uscensusbureau/citysdk/blob/fc5d7880529fedcde181269fc5d518767221281e/v2/GeoJSON/20m/2021/metropolitan-statistical-area!micropolitan-statistical-area.json),
commit `fc5d7880529fedcde181269fc5d518767221281e`; full-file SHA-256
`90d046c4a9851604379780ea0fbb80c61dcec428b539fd9158a6296d7dfda440`.
State provenance/hash is unchanged in the catalog. These Census metropolitan
features implement that vintage's OMB delineations; they do not claim current
OMB boundaries. No mixture with 2023+ names/memberships or new ID crosswalk is
introduced. The reviewed raw properties of the 50 M1 features are retained in
`test/fixtures/metros-2021-source.json` (no geometry).

`GEOID`/`CBSAFP` supply the five-digit metro ID, `LSAD=M1` distinguishes metropolitan
from micropolitan, and the exact official `NAME` supplies the label. Member state
codes come from its explicit suffix, mapped to the unchanged state's FIPS ID.
The verification checks complete source properties, not guessed city similarity.
`shortLabel` is a separately curated display alias, never a different boundary:
San Francisco–Oakland does not silently include San Jose, for example. Official
labels remain in selectors and existing plan/public DTOs.

Every original metro ID, label, state membership and timezone suggestion is
preserved. Existing plans need no rewrite or reassignment. New areas are additive;
ordinary edits never infer a metro from city/neighborhood text. Cross-state metros
share one inventory regardless of the selected member state. The table retains
all source members, including less obvious DE/MD, WI, IN/KY and IA entries.

## Timezones

CBSA/state membership alone is not a timezone source. Preserve the previous
reviewed suggestion subset and extend only its California policy to Sacramento
and Riverside (America/Los_Angeles). The California scope of Pacific time is
specified in [49 CFR 71.9](https://www.ecfr.gov/current/title-49/subtitle-A/part-71/section-71.9).
All other new metros have a null suggestion and require explicit owner choice;
this intentionally favors correctness over filling every field. Some single-state
metros remain null because their state has split zones or this change has not
reviewed a county-level crosswalk. Explicit IANA corrections always survive a
region change; no pickup/DST/scheduling rule changes. Discovery preference never
changes a plan's region or timezone. Null suggestions do not prevent browsing.

## Repeatable verification and future additions

1. Download the linked immutable GeoJSON to a local file, preserving TLS checks.
2. From `giftlink-backend`, run `node util/verify-region-source.js /path/to/download.json`.
   It verifies the complete file hash and all extracted properties; it is offline,
   read-only and never connects to MongoDB. The original file was downloaded again
   and independently hash-checked during 6.4C.
3. For additions, choose actual M1 features in that same source; copy complete
   properties into the reviewed extract and derive ID/name/member states. Add a
   clear display alias without changing the official name. Never invent a CBSA.
4. Leave the timezone null unless a separately documented unambiguous mapping is
   reviewed. Test IDs, memberships, regional exact counts, old-plan compatibility,
   unassigned states, explicit timezone preservation and the actual selector.
5. Run backend lint/tests and normal frontend/local browser/CI checks. No database
   write, index creation, geocoding service or migration is needed.

A future vintage upgrade needs its own ID/boundary/membership crosswalk and a
review of stored plans/cursors/browser preferences. Never silently reuse a changed
boundary to migrate old locations. Runtime directory API and listing DTO contracts
are additive; cached older frontends may not show new choices until refreshed.

## Verified selection

| CBSA | Official 2021 metropolitan name | Member states |
| --- | --- | --- |
| 10740 | Albuquerque, NM | NM |
| 11260 | Anchorage, AK | AK |
| 12060 | Atlanta-Sandy Springs-Alpharetta, GA | GA |
| 12420 | Austin-Round Rock-Georgetown, TX | TX |
| 12580 | Baltimore-Columbia-Towson, MD | MD |
| 13820 | Birmingham-Hoover, AL | AL |
| 14260 | Boise City, ID | ID |
| 14460 | Boston-Cambridge-Newton, MA-NH | MA, NH |
| 16740 | Charlotte-Concord-Gastonia, NC-SC | NC, SC |
| 16980 | Chicago-Naperville-Elgin, IL-IN-WI | IL, IN, WI |
| 17140 | Cincinnati, OH-KY-IN | OH, KY, IN |
| 17460 | Cleveland-Elyria, OH | OH |
| 18140 | Columbus, OH | OH |
| 19100 | Dallas-Fort Worth-Arlington, TX | TX |
| 19740 | Denver-Aurora-Lakewood, CO | CO |
| 19820 | Detroit-Warren-Dearborn, MI | MI |
| 26420 | Houston-The Woodlands-Sugar Land, TX | TX |
| 26900 | Indianapolis-Carmel-Anderson, IN | IN |
| 28140 | Kansas City, MO-KS | MO, KS |
| 29820 | Las Vegas-Henderson-Paradise, NV | NV |
| 30780 | Little Rock-North Little Rock-Conway, AR | AR |
| 31080 | Los Angeles-Long Beach-Anaheim, CA | CA |
| 31140 | Louisville/Jefferson County, KY-IN | KY, IN |
| 33100 | Miami-Fort Lauderdale-Pompano Beach, FL | FL |
| 33340 | Milwaukee-Waukesha, WI | WI |
| 33460 | Minneapolis-St. Paul-Bloomington, MN-WI | MN, WI |
| 34980 | Nashville-Davidson--Murfreesboro--Franklin, TN | TN |
| 35380 | New Orleans-Metairie, LA | LA |
| 35620 | New York-Newark-Jersey City, NY-NJ-PA | NY, NJ, PA |
| 36420 | Oklahoma City, OK | OK |
| 36540 | Omaha-Council Bluffs, NE-IA | NE, IA |
| 36740 | Orlando-Kissimmee-Sanford, FL | FL |
| 37980 | Philadelphia-Camden-Wilmington, PA-NJ-DE-MD | PA, NJ, DE, MD |
| 38060 | Phoenix-Mesa-Chandler, AZ | AZ |
| 38300 | Pittsburgh, PA | PA |
| 38900 | Portland-Vancouver-Hillsboro, OR-WA | OR, WA |
| 39580 | Raleigh-Cary, NC | NC |
| 40060 | Richmond, VA | VA |
| 40140 | Riverside-San Bernardino-Ontario, CA | CA |
| 40900 | Sacramento-Roseville-Folsom, CA | CA |
| 41180 | St. Louis, MO-IL | MO, IL |
| 41620 | Salt Lake City, UT | UT |
| 41700 | San Antonio-New Braunfels, TX | TX |
| 41740 | San Diego-Chula Vista-Carlsbad, CA | CA |
| 41860 | San Francisco-Oakland-Berkeley, CA | CA |
| 42660 | Seattle-Tacoma-Bellevue, WA | WA |
| 45300 | Tampa-St. Petersburg-Clearwater, FL | FL |
| 46060 | Tucson, AZ | AZ |
| 46520 | Urban Honolulu, HI | HI |
| 47900 | Washington-Arlington-Alexandria, DC-VA-MD-WV | DC, VA, MD, WV |
