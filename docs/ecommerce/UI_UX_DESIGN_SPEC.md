# UI and UX design specification

Status: proposal, waiting for approval. Written 2026-11-10.

## 1. What the reference image does

| Aspect | Observed | Keep? |
|---|---|---|
| Composition | One job per screen. Top bar, search, then content, then fixed nav | Keep |
| Welcome | Top two-thirds deep green with a large photo. White panel with a curved top edge rises over it | Keep |
| Palette | Deep blue-leaning green, white, one bright lime used once per screen | Keep |
| Typography | Geometric sans. Bold short headlines, grey supporting text, small labels | Keep |
| Search | Full width, very light grey fill, large radius, grey icon, no border | Keep |
| Banner | Deep green card, white headline, white pill button, fruit bleeding off the right edge | Keep |
| Category tiles | Near-square, very light surface, food cut-outs, label below, not inside | Keep |
| Grid | 4 columns on the home page, 3 columns on the category page | Keep |
| Filter pills | Selected pill is solid deep green. Others outlined | Keep |
| Bottom nav | Five items. Active item is a rounded deep green square with a white icon | Keep |
| Toast | Lime bar over the nav with an action | Keep, with dark text |
| Spacing | Generous and even, about 16 px gutters | Keep |

What is **not** copied: the "Groceria" name and cap, the photo of the person, the image pixels, or claims such as "100% organic" and "within 3 hours", which we cannot back up.

Lime with white small text, as in the image, has weak contrast. This spec uses dark text on lime.

## 2. Things removed because no real data supports them yet

| Element in image | Decision |
|---|---|
| Gift icon | Removed until offers exist |
| Quick Cook, Healthy Life pills | Replaced by real categories |
| Recently Viewed | Later, stored per device |
| Delivery ETA text | Only if the store sets one |
| Track toast | Only for a real open order |
| Bell with count | Only when notifications exist |

## 3. Design tokens

Defined once in the Tailwind theme in `store/`. No arbitrary values when a token fits.

| Token | Value | Use |
|---|---|---|
| `brand-900` | `#1C4A3C` | Deep green: welcome, banner, active nav, main button |
| `brand-700` | `#2C6A55` | Hover |
| `brand-100` | `#E4F0EA` | Selected tints |
| `leaf-500` | `#7AC52B` | Lime accent, once per screen |
| `ink-900` | `#16201C` | Main text |
| `ink-600` | `#5E6B65` | Supporting text |
| `ink-400` | `#66726C` | Placeholder |
| `line` | `#E6EAE7` | Borders |
| `surface` | `#FFFFFF` | Page |
| `surface-soft` | `#F6F7F5` | Tiles, search |
| `success` | `#1F7A4D` | |
| `warning` | `#9A6400` | |
| `danger` | `#B3382C` | |

| Scale | Values |
|---|---|
| Spacing | 4, 8, 12, 16, 24, 32, 48 px |
| Radius | Input and tile 16, card 20, pill full, nav icon 14 |
| Shadow | One soft level, for floating bars only |
| Type | 12, 14, 16, 20, 24, 32 px. Line height 1.25 to 1.5 |
| Touch target | At least 44 px |
| Container | 1200 px max for the shop, 1440 px max for admin |

Colours are checked for contrast, at least 4.5:1 for body text. Dark mode is not in the first release.

Reusable components: `Button`, `Input`, `ProductCard`, `CategoryTile`, `StatusBadge`, `Dialog`, `Toast`, `BottomNav`, `DataTable`, `Timeline`, `FreeDeliveryProgress`. One version of each.

## 4. Responsive layout

| Width | Product grid | Navigation | Cart |
|---|---|---|---|
| Under 640 | 2 columns | Bottom nav | Page |
| 640 to 1023 | 3 to 4 columns | Bottom nav | Page |
| 1024 to 1439 | 4 columns with filter sidebar | Top bar | Drawer and page |
| 1440 and up | 5 columns, capped by container | Top bar | Drawer and page |

No horizontal scroll on the page. Category rows may scroll inside themselves.

## 5. Shop screens

| Screen | Content | Notes |
|---|---|---|
| Welcome | Real produce photo on deep green, curved white panel, short headline, Start shopping, Skip | Once per device. Never blocks a returning customer |
| Home | Delivery or pickup selector, search, one banner, categories, featured, popular | Products within the first screen on a phone |
| Categories | Back, title, search, real category pills, 3-column grid | From the catalogue, never hardcoded |
| Product list | Sort, in-stock filter, load more | |
| Product detail | Large image, name, price, unit, availability, quantity, description, Add | Quantity capped by availability |
| Search | Suggestions with a 250 ms pause, no-result state, clear | Name, SKU, barcode, category |
| Cart | Photo, price, quantity, line total, availability, subtotal, delivery, VAT, total | Numbers come from `/api/store/quote` |
| Checkout | 8 stages from the prompt, shown as short steps | A failed request never clears the cart |
| Confirmation | "Order received — waiting for store acceptance", payment status, next step | Never "Order confirmed" |
| Tracking | Timeline with timestamps, items, payment, address or pickup details | Works after refresh |

### Product card

Square image with `object-fit: contain` on the soft surface, name clamped to two lines, price, unit, availability text, Add button. Cards keep equal height. A missing photo shows a neutral placeholder with a leaf mark and the text "Photo coming soon". We never show a stock photo that could pass for the real item.

### Weighted products

Show "Sold by weight. About 1 kg. Final price after weighing." No live weighing is shown or implied. Actual weight comes from the existing pre-weighed label at handover.

### Delivery and pickup forms

Delivery asks for name, phone, area, address, building details, location note, optional map link. Pickup asks only for name, phone, slot if enabled. Pickup never asks for an address.

## 6. Free delivery progress

Numbers come from the server quote. The browser only draws them.

Threshold rule: free only when the eligible subtotal is **strictly greater than** 5000 halalas. So remaining = 5001 − subtotal.

| State | Shown |
|---|---|
| Pickup selected | Component hidden |
| Empty cart | "Free delivery on orders over SAR 50.00." Fee shown |
| Below or exactly at threshold | "Add SAR 12.00 more to unlock free delivery." Bar shows subtotal, threshold, fee |
| At SAR 50.00 exactly | "Add SAR 0.01 more to unlock free delivery." |
| Above threshold | "You've unlocked free delivery!" Fee shown as Free |
| Quote loading | Last values stay, bar marked as updating |
| Quote failed | "We could not update this. Your cart is safe." |

Width changes through one `progress` value in an isolated component with no animation. Hairline can be added later inside it without changing checkout.

## 7. Order timeline

Isolated `Timeline` component with clear states: done, current, upcoming, stopped. Each step has a timestamp. Delivery and pickup show their own steps. No elaborate animation for now.

## 8. Admin

Same brand, higher density, smaller radii, tables rather than cards. Deep green is used for the header and the main action only.

| Screen | Content |
|---|---|
| Dashboard | Action first: New orders waiting, Stock warnings, Sync status, Payment problems. Then a short count row for the other states. Each count opens the filtered list |
| Orders | 11-field table from the prompt, search, date, status, fulfilment and payment filters, sort, pagination, refresh |
| Order detail | Customer, order lines with photos, per-line stock, payment, status history with staff names. Actions match current status and permission |
| Products | Photo, name, SKU, category, price, unit, on hand, reserved, available, status, updated |
| Product editor | POS fields read-only with "Change this in the POS". Description, photos, status editable |
| Images | Preview, upload progress, primary, reorder, replace, remove, clear errors |
| Stock and sync | Discrepancies, sync health, stale banner |
| Settings | Delivery fee, threshold, areas, hours, stale limit |

Interactions: clicking a count filters the list, clicking availability opens stock detail, a stock warning shows affected products, a customer opens their orders, a payment status filters records, date filters update everything, and every action shows confirmation and a result.

Status always shows text, not just colour.

Reject and refund need a reason and a confirmation.

## 9. POS Online orders tab

Plain tab in the existing desktop style, using its components. Lists accepted orders, scans items, shows the final total, and offers Hand over, which needs an open shift. Also shows Product requests and sync health.

## 10. Visual audit

After build, using the built-in browser at 375, 768, 1280 and 1600 px for every screen in section 19 of the master prompt. Full page, not just the first screen. Playwright and Puppeteer are not used.

English left-to-right only for the first release, subject to the language decision. Arabic checks are explicitly deferred.
