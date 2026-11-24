NOORI PERFUME MANAGER — V4 (repaired release)
=============================================

WHAT THIS IS
V4 is a repair of the V3 "final release candidate". Same Firebase project, same
Firestore path shops/{shopId}/appData/main, same data fields — but every missing
handler is now wired, the five forms that used to reload the page are fixed, and
the dead panels (Customers, Suppliers, Scanner, Activity, Reports extras) are
implemented. Existing shop data loads unchanged; new fields are additive and are
created automatically on first load.

INSTALL
1. Download a JSON backup from the working V3 build first. Keep the old folder.
2. Extract this ZIP to a NEW folder. Do not overwrite the V2/V3 folders.
3. Copy your current, working firebase-config.js from the V3 folder into this
   folder. The included file is a PLACEHOLDER and will not connect.
4. In this folder run:  python -m http.server 8003
5. Open http://localhost:8003 and sign in with the same Firebase account.
6. Confirm old products, sales, purchases and expenses appear BEFORE editing.
7. Do not edit the same shop from V2, V3 and V4 at the same time.

FIREBASE STEPS (do these once)
a) Publish the new firestore.rules. They keep everything working and add:
   - shop writes for staff, store-document deletion for owner only
   - a backups subcollection (shops/{shopId}/backups) for cloud snapshots
b) Restrict your Firebase web API key by HTTP referrer in Google Cloud Console.
c) The app now creates cloud snapshots in a subcollection, NOT in the main
   document, so backups never consume the 1 MB document limit.

WHAT WAS FIXED (V3 -> V4)
1. Page-destroying forms: a capture-phase submit guard plus real handlers on
   stockAdjustmentForm, supplierPaymentForm, customerForm, customerPaymentForm
   and supplierForm. No form can reload the tab and lose a bill again.
2. Silent sync failures: a persistent header status (Saving / Saved HH:MM /
   NOT SAVED…) with a Retry button replaces the 2.6-second toast.
3. Save size guard: writes are blocked with a visible error before the 1 MB
   Firestore document limit is hit, and a storage bar in Settings shows usage.
4. Multi-device writes: a revision counter detects a newer save from another
   device and asks you to keep your changes or reload theirs.
5. CSV export now uses the SAME date range as the report and includes Paid,
   Due, Cost and Gross Profit columns.
6. Dashboard "Today's sales" is now net of refunds and matches Reports.
7. Labels print the product's own price instead of a broken reference.
8. Product priced for loose attar keeps the 12 ml rate as its listed price.
9. All data is normalised on load, so old records with missing fields no longer
   break rendering.

WHAT WAS ADDED (previously dead UI)
- Customers: create/edit/delete (owner), search, outstanding balance,
  payment receipt with history, auto-created on a credit sale.
- Suppliers: create/edit/delete (owner), search, payable balance, payments,
  auto-created from a purchase with a supplier name.
- Credit sales: Customer + Payment mode = Credit records a due; balances are
  derived from sales, payments and refunds.
- Stock Adjustment: add / remove / set actual with a reason and an audit list.
- Activity Log: every sale, purchase, product change, stock move, payment,
  expense, return and backup, filterable.
- Barcode Scanner: SKU/barcode lookup (USB scanner types + Enter) and an
  optional camera scanner using the browser BarcodeDetector API.
- Reports: customer-wise sales, supplier-wise purchases, stock valuation at
  cost and retail, net profit after expenses.
- Cloud snapshots: create / restore / delete, last 5 kept.
- Product photo by URL, and "add this URL as a dashboard slide" one-click.
- PWA: icons, manifest scope, service worker for offline shell.
- Owner/staff permissions enforced in the UI and in firestore.rules.

INVENTORY RULES (unchanged from V3 — still true)
- Loose attar sold by ml: Stock Type = Loose, Unit = ml. Purchase cost is per ml;
  3/6/12 ml selling prices live in Product Master.
- Loose stock in grams is allowed, but the 3/6/12 ml menu only works for ml
  stock. Grams need a density/conversion factor to become ml.
- Packed attar: Stock Type = Packed, Unit = pcs, ml per piece required. Purchase
  cost is per piece.
- Purchases ask for quantity and TOTAL invoice amount; weighted average cost per
  stock unit is calculated. Selling rates are NOT changed by a purchase.
- Packed -> loose transfer subtracts pieces and adds total ml; loose cost per ml
  is estimated as packed piece cost / ml per piece. Wastage, leakage, labour and
  packaging are excluded.
- Selling a product never rewrites saved sale line prices or cost snapshots.
- The calculator uses cost/ml x 12 ml + making charge for a 30 ml reference,
  scaled proportionally. It estimates cost, not a retail price.

LIMITATIONS (unchanged, now visible in the UI)
- All shop data is one Firestore document. Multi-device simultaneous edits use
  last-write-wins with a conflict prompt, but this is still not a concurrent
  multi-staff accounting system.
- Backups are manual. Cloud snapshots exist but are not scheduled.
- Media is URL-based; there is no Firebase Storage upload.
- Camera scanning needs HTTPS/localhost and a browser with a barcode decoder.

FILES
index.html            all pages
app.js                all logic (single file, no duplicated overrides)
styles.css            responsive theme
firebase-config.js    PLACEHOLDER — replace with your own
firestore.rules       publish this
manifest.json         PWA manifest
sw.js                 offline shell cache
icon-192.png / icon-512.png   app icons
README.txt            this file
