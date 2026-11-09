# Hardware testing

Nothing here has been tried on real devices. The tools are ready. Use **Admin → Hardware test**. It makes no sale.

## Barcode scanner

The app expects a keyboard-style scanner that ends each code with Enter.

| Test | Expect |
|---|---|
| Scan one known item | Listed with its product. Marked as a scan, not as typed by hand |
| Scan 10 different items fast | 10 rows, in order |
| Scan one item, then the same item a second later | Two normal scans |
| Same code twice within 0.4 seconds | Flagged as a double read. On Sell the cashier is asked first |
| Scan a code not in the shop | "No product uses this code" |
| On Sell: scan the same item several times | Quantity rises on one line |

## Weighing labels

**Still needed: a photo or scan of a real label from the store's scale.** The layout must not be guessed. Set it in **Admin → Scale labels**, then scan a label in the reader.

Check each part: item code, quantity, PLU, product, price. Weigh a known item, and compare the price with the one printed on the label.

Grams or kilograms: `weight_g` reads 01250 as 1,250 g. `weight_kg3` reads it as 1.250 kg. `weight_kg2` reads 00125 as 1.25 kg. If a weight is 10 or 1,000 times out, the layout is wrong.

## Receipt printer

No model is assumed. The app prints through Windows.

1. Install the printer's Windows driver and make it the default printer.
2. Choose 80 mm or 58 mm in the test screen, and press **Print test receipt**.
3. Check for cut-off text, wrapped long names, and the VAT lines. The slip says TEST - NOT A SALE.
4. Turn the printer off and print again. A clear message should appear.

## Cash drawer

The app has no command that opens a drawer, and the test screen cannot open one. Most drawers wired to a receipt printer open through a setting in the Windows printer driver. Set it there if the shop wants it, then test with a test receipt and a real sale. Whether it should open for card sales is the owner's choice, and depends on the driver.

The screen also shows expected against counted cash for the shift, and whether any shift's cash does not add up.

## Physical tests still to do

- [ ] Real scanner: speed, suffix key, double reads
- [ ] Real scale label: format, grams or kilograms, price match
- [ ] Real receipt printer: alignment, paper width, failure message
- [ ] Cash drawer with the store's printer
- [ ] Install on a clean Windows computer
- [ ] Update on a shop computer
- [ ] Arabic: keyboard, right-to-left screens, Arabic receipts, translations (deferred by the owner)
