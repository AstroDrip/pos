# POS User Manual

<!-- Generated from src/renderer/help/content.ts by `npm run manual`. Do not edit by hand: edit the help content. -->

This manual is the same text as the Help tab in the app. It covers only what the app does today.
Names and numbers in the examples are made up.

## Contents

- **Getting started**
  - [Log in and log out](#start-login)
  - [Find your way around the screen](#start-screen)
  - [Keyboard keys at the till](#start-keys)
  - [Quick Actions (Ctrl+K)](#start-quick-actions)
  - [Change the keyboard keys](#admin-shortcuts)
- **Selling**
  - [Scan a product](#selling-scan)
  - [Find a product by name or code](#selling-search)
  - [Change a quantity (+, − or type a number)](#selling-quantity)
  - [Sell weighed goods (scale labels)](#selling-weighed)
  - [Remove an item or clear the whole bill](#selling-remove)
  - [Give a discount on a line](#selling-discount)
  - [Hold a bill and bring it back](#selling-hold)
  - [Attach a customer to a sale](#selling-customer)
- **Taking payments**
  - [Take a payment (cash, card or both)](#payments-take-payment)
  - [Reprint the last receipt](#payments-reprint)
  - [Sell on credit (the customer pays later)](#payments-credit-sale)
- **Customers and credit**
  - [Find or add a customer](#customers-find-add)
  - [Allow a customer to buy on credit](#customers-credit-settings)
  - [Receive a payment from a customer (full or part)](#customers-receive-payment)
  - [Check what a customer owes and print a statement](#customers-statement)
  - [Mark an invoice as disputed or write off a debt](#customers-dispute-writeoff)
- **Suppliers and purchasing**
  - [Add a supplier](#suppliers-add)
  - [Change a supplier](#suppliers-edit)
  - [Set the store details on the receipt](#admin-store-details)
  - [Receive goods from a supplier](#suppliers-receive)
  - [Enter a supplier bill](#suppliers-enter-bill)
  - [Record a supplier invoice (pay now or later)](#suppliers-invoice)
  - [Pay a supplier (full or part)](#suppliers-pay)
  - [See what the store owes suppliers](#suppliers-balances)
  - [Return goods to a supplier](#suppliers-return)
- **Stock and products**
  - [See all products](#stock-find-products)
  - [View stock on hand](#stock-overview)
  - [Record damaged or expired goods (wastage)](#stock-wastage)
  - [Count the shelves (stock count)](#stock-count)
  - [Add or change a product](#stock-products)
- **Returns and refunds**
  - [Refund a customer](#returns-refund)
- **Expenses and accounts**
  - [Record an expense (rent, electricity and others)](#expenses-record)
  - [Pay an expense that is still owed](#expenses-pay)
  - [Set up recurring expenses (monthly rent, bills)](#expenses-recurring)
- **Reports and the owner overview**
  - [View sales for a day or a month](#reports-sales)
  - [Read the owner overview, profit and balances](#reports-owner)
- **Shifts and daily work**
  - [Start a shift](#shifts-open)
  - [Record cash put in or taken out of the drawer](#shifts-cash-in-out)
  - [Close a shift and check the cash](#shifts-close)
  - [Find a mistake or ask for authorisation](#shifts-mistakes)
- **Backup and recovery**
  - [Make a backup and check it worked](#backup-run)
  - [Restore a backup](#backup-restore)
  - [The computer stops responding](#backup-frozen)
- **Real situations, step by step**
  - [A. A customer pays normally](#scenario-a-normal-sale)
  - [B. A customer buys on credit](#scenario-b-credit)
  - [C. A customer pays part of what they owe](#scenario-c-part-payment)
  - [D. A customer returns goods](#scenario-d-return)
  - [E. A supplier delivers and wants payment later](#scenario-e-supplier-later)
  - [F. A supplier is paid part of the bill](#scenario-f-supplier-part)
  - [G. The cashier scanned the wrong quantity](#scenario-g-wrong-qty)
  - [H. The cashier cannot find a product](#scenario-h-cannot-find)
  - [I. The cashier picked the wrong product](#scenario-i-wrong-product)
  - [J. A manager checks the day's performance](#scenario-j-day)

## Getting started

<a id="start-login"></a>

### Log in and log out

**What this does:** Each person uses their own username and PIN, so every sale and change is recorded under the right name.

**Steps**

1. Type your username in the Username box.
2. Type your PIN (4 to 8 digits) in the PIN box.
3. Press Log in.
4. When you leave the till, press Log out at the top right.

**What you should see:** The tabs (Sell, Refund and others) appear at the top, and your name is shown at the top right.

**If something goes wrong**

- *The app says the username or PIN is wrong.* Type the PIN again slowly. If it still fails, ask the owner to check your user in Admin → Users.
- *The screen says "First-time setup: create the owner account".* This appears only on a new installation. The owner should fill it in, not a cashier.

**Ask a supervisor:** Never share your PIN. If someone else learns it, ask the owner to change it.

<a id="start-screen"></a>

### Find your way around the screen

**What this does:** The bar at the top holds the tabs and a few settings for this till.

**Steps**

1. Tabs are grouped: Sell, Refund, Customers · Stock, Products, Purchases · Expenses, Accounting, Reports · Shift, Admin, Help.
2. Press a tab to open that screen.
3. Use the Light / Dark box to change the colours of this till.
4. Press العربية or English to change the language of the screens.
5. The coloured dot shows when the last backup was made.

**What you should see:** The tab you chose is highlighted and its screen opens below the bar.

**If something goes wrong**

- *I cannot see this tab.* Your user does not have permission for it. Ask the owner to check your role in Admin → Users.

<a id="start-keys"></a>

### Keyboard keys at the till

**What this does:** You can take a whole order with the keyboard and scanner, without the mouse.

**Keys:** `F1` `F4` `Ctrl+F` `Ctrl+K` `Shift+Enter` `Enter` `Ctrl+Enter` `+` `-` `Esc` `↑` `↓`

**Steps**

1. Type or scan in the search box. Suggestions appear from the first letter. Use ↑ and ↓ to move in the list.
2. F1: opens help for the screen you are on, over the screen. Your bill stays. Esc goes back.
3. F4: on Sell, goes to the quantity of the last item on the bill. Type a number, or press + or −, then Enter.
4. Ctrl+F: goes to the main search box of the screen. It will not move you while you are typing in another box.
5. Ctrl+K: opens Quick Actions. Then press one letter.
6. Shift+Enter: with the search box empty, goes to the payment step. It never takes a payment.
7. Enter: in Cash received on the payment step, pays cash. Elsewhere it picks the highlighted item or confirms the quantity.
8. Ctrl+Enter: on the payment step, records a card payment. Press it only after the bank terminal shows APPROVED.
9. +: adds one in the quantity box, or to the last item when the search box is empty.
10. -: takes one off in the quantity box, or from the last item when the search box is empty.
11. Esc: closes a popup or a suggestion list. On Sell it also goes back one step.
12. For more, press Ctrl+K and then one letter. See Quick Actions.

**What you should see:** Each key does one clear thing. Shift+Enter only opens the payment step; it never takes a payment.

**If something goes wrong**

- *Shift+Enter shows "Pick the product (↑↓ Enter) or clear the search first."* There is still text in the search box. Choose the product, or delete the text, then press Shift+Enter again.
- *Shift+Enter shows "Press Enter to add the item, or Esc to cancel."* The quantity box is still open. Press Enter to add the item first.

<a id="start-quick-actions"></a>

### Quick Actions (Ctrl+K)

**What this does:** A short list of what you can do on the screen you are on. Press Ctrl+K first, then one letter. Letters only work while the list is open, so normal typing and scanning are never affected.

**Where:** Any screen, after you log in. You see only what you are allowed to do on that screen.

**Keys:** `Ctrl+K` `P` `C` `S` `H` `R` `I` `M` `↑` `↓` `Enter` `Tab` `Esc`

**Steps**

1. Press Ctrl+K. The list opens and shows each action with its letter.
2. Press the letter. Or use ↑ and ↓, then Enter. Or press Tab and type the name of what you want.
3. P: Product search. Goes to the product search box. On Purchases it opens Return to supplier first.
4. C: Customer search. Goes to the customer box.
5. S: Supplier search. Find a supplier by name and open their statement. Nothing is paid.
6. H: Hold current order. Puts the current order on hold, like the Hold bill button.
7. R: Retrieve held order. Shows the held orders. Choose one to bring it back.
8. I: Item information. Shows the price and stock of an item. Scan it or type its name. It does not add anything to the bill.
9. M: Money. Opens customer collection (Customers, Sell) or supplier settlement (Purchases). You still type the amount and press the button yourself; nothing is paid by this key.
10. Press Esc to close the list. You go back to the box you were in.

**What you should see:** The action opens at once. A grey action cannot be used right now, and the reason is shown beside it.

**If something goes wrong**

- *Ctrl+K shows "Press Enter to add the item, or Esc to cancel."* The quantity box is open. Finish the quantity first, then press Ctrl+K.
- *The letter you want is not in the list.* It does not belong to this screen, or your user is not allowed to use it.
- *Collection or settlement did not take a payment.* That is correct. The letter only opens the place to pay. You type the amount and press the button yourself.

<a id="admin-shortcuts"></a>

### Change the keyboard keys

**What this does:** Choose your own key for each function. The change applies to every user on this till as soon as you save it.

**Where:** Admin tab → Keyboard shortcuts.

**Steps**

1. Open the Admin tab and find Keyboard shortcuts.
2. Press Change beside the function.
3. Press the new key. For Quick Actions, press one letter.
4. Press Save shortcuts.
5. To undo one change, press Default on that row. To undo them all, press Reset all to default.

**What you should see:** A green message says the shortcuts are saved. The keys shown on the Sell screen change too.

**If something goes wrong**

- *It says the key is needed for typing or the window.* Choose a function key such as F6, or Ctrl or Alt with a letter. Keys used for typing, copy and paste, or closing the window cannot be used.
- *It says the key is already used.* Two functions cannot share a key. Change the other function first, or choose another key.
- *You changed Enter for cash and now Enter does not pay.* That is correct: the new key pays instead. Enter still picks items and confirms quantities. The Cash button shows the key in use.

**Ask a supervisor:** Only a user allowed to change settings can do this. Every change is written to the audit log.

## Selling

<a id="selling-scan"></a>

### Scan a product

**What this does:** The scanner adds the product to the bill straight away.

**Where:** Sell tab.

**Steps**

1. Hold the barcode under the scanner until it beeps.
2. Check that the product appears in the bill with quantity 1.
3. Scan the same product again to add one more.

**What you should see:** The product, its price and the new total appear on the screen.

**If something goes wrong**

- *"Not found" appears.* The barcode is not in the system. Search for the product by name instead, and tell the owner so the barcode can be added in Products.
- *"… was scanned twice very quickly. Add it again?"* Press OK only if the customer really has two. Otherwise press Cancel.
- *"… is sold by weight. Scan the scale label."* Weighed goods need the label printed by the scale. Ask the customer to have the item weighed.

<a id="selling-search"></a>

### Find a product by name or code

**What this does:** Type part of the name, or a barcode, PLU or SKU. Suggestions start from the first letter.

**Where:** Sell tab, the "Scan or search" box.

**Keys:** `↑` `↓` `Enter` `Esc`

**Steps**

1. Click the search box, or just start typing.
2. Type the first letter or two of the product name, in English or Arabic.
3. Look at the list. Exact codes come first, then names that start with what you typed. Among those, items customers buy most often come first.
4. Press ↓ to move to the right product, or keep typing to narrow the list.
5. Press Enter to choose it.
6. The quantity box opens with 1. Type another number if needed, then press Enter.

**What you should see:** The product appears in the bill and the search box is empty and ready for the next item.

**If something goes wrong**

- *"No matching products".* Check the spelling, try fewer letters, or try the Arabic name. See "The cashier cannot find a product".
- *Typed digits added a different product.* Digits always look up the exact code. Use ↓ to pick from the list if you meant a name.

<a id="selling-quantity"></a>

### Change a quantity (+, − or type a number)

**What this does:** Change how many of an item are in the bill before payment.

**Where:** Sell tab, the Qty column of the bill.

**Keys:** `+` `−` `Enter`

**Steps**

1. Find the line in the bill.
2. Press + beside its quantity to add one.
3. Press − to take one off.
4. Or click the number, type the right quantity, and press Enter.
5. Check the new total.

**What you should see:** The quantity and the bill total change straight away.

**If something goes wrong**

- *The line disappeared.* The quantity reached zero, so the line was removed. Press Undo in the message under the bill within a few seconds to bring it back.
- *"Type a whole number from 0 to 9999."* Items sold by the piece take whole numbers only. Type a number like 3.
- *A weighed item has no + and − buttons.* The weight comes from the scale label and cannot be typed. Remove the line with ✕ and scan the right label.

**Ask a supervisor:** Every removed item is recorded in Reports, even if you undo it. This is normal and not an accusation.

<a id="selling-weighed"></a>

### Sell weighed goods (scale labels)

**What this does:** Fruit, vegetables, meat and other goods sold by weight are weighed on the scale, which prints a label. The label carries the weight.

**Where:** Sell tab.

**Steps**

1. Ask for the item to be weighed on the scale. The scale prints a label.
2. Scan the label like any barcode.
3. Check the weight and price on the bill line.

**What you should see:** A new line shows the product with its weight in kg and the price for that weight.

**If something goes wrong**

- *"… is sold by weight. Scan the scale label."* You picked a weighed item from the list or typed its code. Weighed goods can only be added from a scale label.
- *The label is not recognised.* Tell a supervisor. The owner can test the label in Admin → Scale labels.

<a id="selling-remove"></a>

### Remove an item or clear the whole bill

**What this does:** Take a wrong item off the bill, or start again with an empty bill.

**Where:** Sell tab.

**Steps**

1. To remove one line, press ✕ at the end of that line.
2. To empty the whole bill, press Clear bill and then OK.

**What you should see:** The line or the bill is gone and the total is updated.

**If something goes wrong**

- *I removed the wrong line.* Scan or search the product again to add it back.

**Ask a supervisor:** Removals are recorded under your name in Reports → Items removed before payment.

<a id="selling-discount"></a>

### Give a discount on a line

**What this does:** Take an amount off one line of the bill.

**Where:** Sell tab, the Discount box on the line.

**Steps**

1. Click the Discount box on the line.
2. Type the amount in SAR to take off that line (for example 2.00).
3. Click somewhere else. The amount and total change.
4. If "Discount needs a supervisor" appears, a supervisor types their username and PIN in the boxes shown before payment.

**What you should see:** The line amount and the bill total are lower.

**If something goes wrong**

- *"A discount is larger than its line amount."* The discount must be smaller than the line amount. Correct the number.

**Ask a supervisor:** Discounts need a supervisor unless your role allows them.

<a id="selling-hold"></a>

### Hold a bill and bring it back

**What this does:** Put a bill aside while the customer fetches something, and serve the next person.

**Where:** Sell tab.

**Steps**

1. Press Hold bill. The bill is saved and the screen is empty.
2. Serve the next customer.
3. When the first customer is back, find their bill under "Held bills" above the cart.
4. Press it to bring the items back.

**What you should see:** The held bill returns with its items. The current bill must be empty first.

**If something goes wrong**

- *"Finish or hold the current bill first."* Finish or hold the bill on screen, then bring back the held one.
- *The discount is gone after bringing the bill back.* Discounts are not kept on held bills. Enter the discount again.

<a id="selling-customer"></a>

### Attach a customer to a sale

**What this does:** Put a customer on the sale. This is needed for credit sales and keeps their history.

**Where:** Sell tab, the Customer (optional) box.

**Steps**

1. Type the customer's phone number in the Customer box.
2. Press Enter.
3. If one customer matches, their name appears.
4. If no one matches, the app asks whether to create a new customer with this phone. Press OK to create.

**What you should see:** The line "Customer: name" is shown next to the bill.

**If something goes wrong**

- *Several customers match.* Type more of the phone number and press Enter again.

## Taking payments

<a id="payments-take-payment"></a>

### Take a payment (cash, card or both)

**What this does:** Finish the order and record how the customer paid. The receipt prints when the sale is saved.

**Where:** Sell tab, the Payment area on the right.

**Keys:** `Enter` `Shift+Enter` `Ctrl+Enter` `Esc`

**Steps**

1. When all items are in the bill, make sure the search box is empty.
2. Press Enter or Shift+Enter. The Payment area becomes active.
3. Cash: type the amount the customer gave in Cash received (leave it blank if they gave the exact amount), then press Enter or the Cash button.
4. Card: wait until the bank terminal shows APPROVED. Then press Ctrl+Enter or the Card button.
5. Cash and card together: type the card part in "Card part of a split payment", then type the cash in Cash received and press Enter.
6. Read the message: it shows the change to give back.
7. Give the receipt and the change to the customer.

**What you should see:** A green message "SAVED INV-… Change: … SAR" appears, the receipt prints and the bill is empty for the next customer.

**If something goes wrong**

- *"NOT SAVED: …"* The sale was not saved. Read the reason, fix it, and pay again. Nothing was charged in the system.
- *The receipt did not print.* The sale is saved. Check the printer paper and press Reprint last receipt (copy).
- *I pressed Esc by mistake.* Esc only goes back to the bill. Nothing is lost. Press Enter on the empty search box to return to payment.
- *"A split payment is in progress"* You typed a card part. Finish by pressing Enter in Cash received.

**Ask a supervisor:** Never press Card before the bank terminal says APPROVED.

<a id="payments-reprint"></a>

### Reprint the last receipt

**What this does:** Print a copy of the last receipt, for example when the paper ran out.

**Where:** Sell tab, under the payment buttons.

**Steps**

1. Press Reprint last receipt (copy).
2. Give the copy to the customer.

**What you should see:** A receipt marked as a copy prints.

**If something goes wrong**

- *Nothing prints.* Check the printer is on, has paper and its cover is closed. Then try again.

**Ask a supervisor:** Reprints are counted in Reports → Activity by cashier.

<a id="payments-credit-sale"></a>

### Sell on credit (the customer pays later)

**What this does:** Let a trusted customer take goods now and pay later. Part can be paid now.

**Where:** Sell tab.

**Steps**

1. Attach the customer (type their phone in the Customer box and press Enter).
2. Look at the credit box: it shows what they owe now and how much credit is available.
3. Add the items as usual.
4. If the customer pays part now, type that amount in Cash received.
5. Press Credit (rest on account).
6. If the sale goes over the credit limit, a supervisor types their username and PIN in the boxes shown, then press the button again.

**What you should see:** The sale is saved, the receipt prints, and the amount on account is added to what the customer owes.

**If something goes wrong**

- *"Attach the customer first (phone box) to sell on credit."* Attach the customer, then try again.
- *"… is not set up for credit."* Only customers allowed to buy on credit can. The owner or a supervisor can allow it in Customers → Credit settings.
- *"Nothing is left to put on account."* The customer paid the whole bill now. Use Cash or Card instead.

**Ask a supervisor:** Going over a customer's credit limit always needs a supervisor.

## Customers and credit

<a id="customers-find-add"></a>

### Find or add a customer

**What this does:** Look up a customer's account, or add a new customer.

**Where:** Customers tab.

**Steps**

1. Type a name, phone number or customer number in "Find a customer". Results appear from the first letter, with exact phone numbers and the most recent customers first.
2. Press a customer in the list to open their account.
3. To add someone new, type the name in "New customer name" and the phone, then press Add customer.

**What you should see:** The account shows what the customer owes, their limit and their invoices.

**If something goes wrong**

- *I cannot see this tab.* Your user does not have permission for it. Ask the owner to check your role in Admin → Users.

<a id="customers-credit-settings"></a>

### Allow a customer to buy on credit

**What this does:** Decide who may buy on credit, up to what amount, and how many days they have to pay.

**Where:** Customers tab → open the customer → Credit settings.

**Steps**

1. Tick "Allowed to buy on credit".
2. Type the Credit limit in SAR, or tick "No fixed limit (trusted customer)".
3. Type how many days they have to pay in "Pay within (days)".
4. Press Save credit settings.

**What you should see:** The account shows the new limit and available credit.

**If something goes wrong**

- *"Type a credit limit, or tick No fixed limit"* Choose one of the two before saving.

**Ask a supervisor:** Only users allowed to manage credit see these settings.

<a id="customers-receive-payment"></a>

### Receive a payment from a customer (full or part)

**What this does:** Record money a customer brings to pay what they owe, and choose which invoices it pays.

**Where:** Customers tab → open the customer → Receive a payment.

**Steps**

1. Type the amount received in "Amount received (SAR)".
2. Choose how they paid: cash, card or bank.
3. Press "Suggest: oldest first". The app fills in the oldest invoices first.
4. Check the amounts in the Apply column. Change them if the customer wants to pay a specific invoice.
5. Press Record payment.
6. Give the customer the payment receipt.

**What you should see:** "Payment … recorded." appears. Owed now goes down. Invoices show Paid or Partially paid.

**If something goes wrong**

- *"Check the amounts: no more than each invoice owes…"* One invoice has more applied than it owes, or the total applied is more than the payment. Correct the numbers.
- *The customer paid more than they owe.* The extra is kept as an advance and can be used for later invoices.

<a id="customers-statement"></a>

### Check what a customer owes and print a statement

**What this does:** See a customer's balance, overdue invoices and every movement on their account.

**Where:** Customers tab.

**Steps**

1. Open the customer. The tiles show Owed now, Overdue, Advance held, Credit limit and Available credit.
2. Under Statement, choose the dates and press Show statement.
3. Press Copy as CSV to paste it into Excel.
4. To see every customer by how late they are, press Ageing at the top of the Customers tab.

**What you should see:** The statement lists sales, payments and refunds with a running balance.

**If something goes wrong**

- *A balance is negative.* A negative balance is an advance the store holds for the customer.

<a id="customers-dispute-writeoff"></a>

### Mark an invoice as disputed or write off a debt

**What this does:** Flag an invoice the customer disagrees with, or write off a debt that will not be paid.

**Where:** Customers tab → open the customer → Credit invoices.

**Steps**

1. Find the invoice.
2. Press Dispute and type a note, then Confirm. Press Clear dispute when it is solved.
3. To write off, press Write off, type why, and Confirm. The whole remaining amount is written off.

**What you should see:** The invoice shows its new status.

**If something goes wrong**

- *I do not see these buttons.* Only users with permission to manage credit or write off debts see them.

**Ask a supervisor:** Write-offs are for the owner or a supervisor to decide.

## Suppliers and purchasing

<a id="suppliers-add"></a>

### Add a supplier

**What this does:** Add a company the store buys from.

**Where:** Admin tab → Suppliers.

**Steps**

1. Type the Name, and the Phone and VAT number if you have them.
2. Type the Payment terms in days (for example 30). Use 0 if they want payment on delivery.
3. Press Add supplier.

**What you should see:** The supplier appears in the list and in every supplier box.

**If something goes wrong**

- *I cannot see this tab.* Your user does not have permission for it. Ask the owner to check your role in Admin → Users.

<a id="suppliers-edit"></a>

### Change a supplier

**What this does:** Correct a supplier, or add their address, CR number, salesman and your customer number with them.

**Where:** Admin tab → Suppliers.

**Steps**

1. Press Edit beside the supplier.
2. Change the boxes you need.
3. Press Save supplier. To leave without changing anything, press Cancel.

**What you should see:** The list shows the change.

**If something goes wrong**

- *I cannot see this tab.* Your user does not have permission for it. Ask the owner to check your role in Admin → Users.

<a id="admin-store-details"></a>

### Set the store details on the receipt

**What this does:** Set the name, VAT number, address, mobile and logo that print on every receipt.

**Where:** Admin tab → Store details.

**Steps**

1. Type each box as it is on your VAT certificate and commercial register.
2. Type the Address as printed on the receipt, and the National address parts.
3. Choose a Logo, if you have one. It must be a PNG or JPEG file of 200 KB or less.
4. Type the Thank-you lines.
5. Check the Preview, then press Save store details.

**What you should see:** A green message says the details are saved. The next receipt prints them.

**If something goes wrong**

- *It says the VAT number is wrong.* It must be 15 digits, starting and ending with 3.
- *The logo is refused.* Use a PNG or JPEG file, and make it smaller than 200 KB.
- *The receipt says TEST BUILD.* That is correct for now. It stays until the connection to the tax authority is finished.

**Ask a supervisor:** Only a user allowed to change settings can do this.

<a id="suppliers-receive"></a>

### Receive goods from a supplier

**What this does:** Record what arrived, so stock goes up and the cost is known.

**Where:** Stock tab → Receive goods.

**Steps**

1. Choose the Supplier.
2. Type the supplier invoice or delivery note number.
3. Under Add product, type the first letters of a product and press its name.
4. Type the quantity received and the unit cost excluding VAT.
5. Repeat for every product on the delivery.
6. Press Save receipt.

**What you should see:** "Received …" appears and Stock on hand goes up.

**If something goes wrong**

- *A product is missing.* Add it first in the Products tab.

<a id="suppliers-enter-bill"></a>

### Enter a supplier bill

**What this does:** Type a supplier paper line by line, when the goods arrive. Stock, cost, what you owe and VAT all update from this one screen.

**Where:** Purchases tab → Enter supplier bill.

**Steps**

1. Choose the Supplier and the Paper type. Type the Number on the paper.
2. If it is an invoice, press Paid or Credit, as the paper says.
3. Paid: choose where the money came from. Till cash needs an open shift.
4. Credit: leave the due date blank to use the supplier terms. Type Part paid now if some was paid at delivery.
5. Add a line: type the supplier code, barcode or name, then press Enter.
6. Type Pack name and Pieces in pack. You do not need to know what a code like CU or SU means. Open one box, count the pieces, and type that number. The app remembers it for this supplier code.
7. Type Packs and Loose pieces, and any Free pieces. Type the Price, per pack or per piece, and the Discount.
8. If the VAT on the paper is different from the VAT shown, type it in VAT printed.
9. If fewer pieces arrived than the paper says, type the real number in Received.
10. In Check against the paper, type the Net, VAT and Total from the paper.
11. Press Save bill.

**What you should see:** A green message shows the goods receipt number. Stock on hand goes up, and the cost per piece is worked out for you.

**If something goes wrong**

- *Save bill is grey.* Look at Check against the paper. The Gap must be empty or 0.00 for Net, VAT and Total. Also check that Paid or Credit is pressed, and that any cost warning is ticked.
- *A cost warning appears.* The cost per piece looks wrong. The usual cause is the wrong Pieces in pack. Fix it, or tick the box if the cost is right.
- *A delivery note has no Paid or Credit.* That is correct. The goods come in now, and nothing is owed until the invoice comes. Enter the invoice later in Supplier invoices.
- *The paper is a proforma.* The VAT is not claimed unless you tick the box. Ask your accountant if you are not sure.
- *It says a delivery note has no invoice yet, or a proforma has the same total.* Those goods may already be in stock. If this paper is for the same goods, press Start over and enter it under Supplier invoices. If they are different goods, tick the box and press Save bill.
- *You closed the screen before saving.* Open Enter supplier bill again. Your lines are still there. To throw them away, press Start over.

<a id="suppliers-invoice"></a>

### Record a supplier invoice (pay now or later)

**What this does:** Match the supplier's invoice to the goods received, so the app knows what the store owes.

**Where:** Purchases tab → Enter a supplier invoice.

**Steps**

1. Receive the goods first in the Stock tab.
2. Choose the Supplier. The goods receipts not yet invoiced appear.
3. Tick the receipts this invoice covers.
4. Type the invoice number, supplier VAT number and invoice date.
5. Type the net amount and the VAT from the invoice.
6. To pay part now, type it in "Paid now" and choose Bank or Till cash. Leave it blank if everything is paid later.
7. If there is no due date, tick "No due date (informal credit)" and describe the arrangement.
8. Press Save supplier invoice.

**What you should see:** "Supplier invoice saved as …" appears and the amount owed shows under "What we owe suppliers".

**If something goes wrong**

- *There is a difference between goods received and the invoice.* Type the reason for the difference in the box that appears.

**Ask a supervisor:** Purchase figures are provisional until the store's accountant approves them.

<a id="suppliers-pay"></a>

### Pay a supplier (full or part)

**What this does:** Record a payment to a supplier and choose which invoices it settles.

**Where:** Purchases tab → Pay a supplier.

**Steps**

1. Choose the Supplier. Their open invoices appear.
2. Type the amount and the payment date, and choose Bank or Till cash.
3. Press "Suggest: oldest first", or type how much goes to each invoice.
4. If you pay more than the invoices, tick "Record the rest as an advance to this supplier".
5. Press Record payment.

**What you should see:** "Payment … recorded." The supplier's balance goes down.

**If something goes wrong**

- *Till cash is not allowed.* Paying from the till needs an open shift. Open one in the Sell tab, or pay by bank.

<a id="suppliers-balances"></a>

### See what the store owes suppliers

**What this does:** See every supplier's balance and a statement of invoices, returns and payments.

**Where:** Purchases tab → What we owe suppliers.

**Steps**

1. Look at the Balance owed column.
2. Press Statement on a supplier to see each invoice, return and payment.

**What you should see:** A list of suppliers with what is owed to each.

**If something goes wrong**

- *A balance shows "advance/credit".* The store paid more than it owes, or returned goods. The supplier owes the store.

<a id="suppliers-return"></a>

### Return goods to a supplier

**What this does:** Send goods back to a supplier. Stock goes down and the supplier owes the store the credit.

**Where:** Purchases tab → Return goods to a supplier.

**Steps**

1. Choose the Supplier.
2. Add each product and the quantity going back.
3. Type the return date, reason, and the credit amount and VAT from the supplier.
4. Press Save return.

**What you should see:** "Return saved as …" and stock is taken out at cost.

## Stock and products

<a id="stock-find-products"></a>

### See all products

**What this does:** See every product without searching, and bring back a product that was turned off.

**Where:** Products tab.

**Steps**

1. Open the Products tab. With the search box empty, the list shows your products from A to Z.
2. If there are many, press Show more at the bottom.
3. To narrow the list, type in the search box.
4. To see products that were turned off, choose Turned off in the box beside the search.
5. Click a product to change it. To bring one back, type a Reason and press Turn product back on.

**What you should see:** The line above the list says how many products are shown. A product turned back on can be scanned and sold again.

**If something goes wrong**

- *I cannot see this tab.* Your user does not have permission for it. Ask the owner to check your role in Admin → Users.

<a id="stock-overview"></a>

### View stock on hand

**What this does:** See how much of each product the store has, and which ones need ordering.

**Where:** Stock tab → Stock on hand.

**Steps**

1. Look at the Qty column for each product.
2. Tick "Only at or below reorder level" to see only products that need ordering.

**What you should see:** A list of products with quantity, reorder level and average cost.

**If something goes wrong**

- *I cannot see this tab.* Your user does not have permission for it. Ask the owner to check your role in Admin → Users.

<a id="stock-wastage"></a>

### Record damaged or expired goods (wastage)

**What this does:** Take goods out of stock that cannot be sold.

**Where:** Stock tab → Record wastage.

**Steps**

1. Choose the reason, or choose Other and describe it.
2. Add each product and the quantity thrown away.
3. Press Save wastage.

**What you should see:** A message shows how many products changed and the value at cost.

<a id="stock-count"></a>

### Count the shelves (stock count)

**What this does:** Set the system quantity to what is really on the shelf.

**Where:** Stock tab → Stock count.

**Steps**

1. Count when the shop is closed.
2. Type a short note, for example "Monthly count, aisle 3".
3. Add each product and type the counted quantity.
4. Press Post count.

**What you should see:** The stock is set to your counts. Differences appear in Reports.

**If something goes wrong**

- *"Count matches the system: nothing changed"* Good: your count agrees with the system.

<a id="stock-products"></a>

### Add or change a product

**What this does:** Add a new product, change a price, add other names for search, or stop selling a product.

**Where:** Products tab.

**Steps**

1. New product: fill in SKU, Name (Arabic), Name (English), Sold by (Piece or Weight), the shelf price including VAT, the VAT %, and the barcode or PLU. Press Save product.
2. Weighed products need a PLU so scale labels can find them.
3. To change a product, type its name in Search products and press it.
4. Type the new price and press Save price.
5. Add other names customers use (for example "Biryani rice") and press Save names.
6. To stop selling it, type a reason and press Deactivate product.

**What you should see:** "Saved …" appears. The change shows in the Sell search at once.

**If something goes wrong**

- *A barcode or PLU is refused.* It already belongs to another product. Check the other product first.

## Returns and refunds

<a id="returns-refund"></a>

### Refund a customer

**What this does:** Give money back for goods a customer returns. The store needs the receipt.

**Where:** Refund tab.

**Steps**

1. Ask for the receipt.
2. Type the invoice number from the receipt and press Find sale.
3. Check the sale details and the store policy shown on screen.
4. In Refund qty, type how many of each item come back.
5. Untick "Back on shelf" for damaged or expired goods.
6. Choose or type the Reason.
7. A supervisor types their username and PIN.
8. Press the Refund button. It shows the amount.
9. Give the cash and the printed credit note to the customer.

**What you should see:** "Refund … saved. Give the customer … in cash." and a credit note prints.

**If something goes wrong**

- *"This sale is … days old."* Refunds are allowed only within the days shown in the store policy. Explain this politely and ask a supervisor if the customer insists.
- *The customer has no receipt.* The store policy requires the receipt. Ask a supervisor.
- *The sale was paid by card.* Store policy: the refund is given in cash.
- *The sale was on credit.* The refund first lowers what the customer owes. Only the rest, if any, is paid in cash.

**Ask a supervisor:** Every refund needs a supervisor's username and PIN.

## Expenses and accounts

<a id="expenses-record"></a>

### Record an expense (rent, electricity and others)

**What this does:** Record a store cost, now or paid later, so profit is correct.

**Where:** Expenses tab → New expense.

**Steps**

1. Choose the Category, for example Rent or Electricity.
2. Type the payee, the invoice number and a short description.
3. Type the expense date and, if it is paid later, the due date.
4. Type the total including VAT. Choose the VAT treatment and check the VAT amount against the bill.
5. For rent paid for a whole year, tick "Covers several months" and choose the first and last month.
6. Press Save and post (unpaid), or Post and pay by bank, or Post and pay from till.

**What you should see:** The expense appears in the list as owed or paid.

**If something goes wrong**

- *"Choose a category"* Every expense needs a category.
- *I am not sure of the amount yet.* Press Save draft. Edit and post it when the bill arrives.

**Ask a supervisor:** Expense categories and accounts are provisional until the accountant approves them.

<a id="expenses-pay"></a>

### Pay an expense that is still owed

**What this does:** Record payment of an expense posted earlier.

**Where:** Expenses tab → press the expense.

**Steps**

1. Type the amount, choose Bank or Till cash, and the payment date.
2. Press Record payment.

**What you should see:** "Payment recorded" and the expense shows as paid.

<a id="expenses-recurring"></a>

### Set up recurring expenses (monthly rent, bills)

**What this does:** Let the app create a draft for regular costs each month, quarter or year. Nothing is paid automatically.

**Where:** Expenses tab → Recurring expenses.

**Steps**

1. Type a name, choose the category, how often, the due day and the expected amount.
2. For bills that change, such as electricity, tick "Amount changes each time".
3. Press Add recurring expense.
4. Each period, open the draft, enter the real amount and post it.

**What you should see:** Drafts appear when each period starts.

## Reports and the owner overview

<a id="reports-sales"></a>

### View sales for a day or a month

**What this does:** See sales, refunds, cashiers and stock changes for any dates.

**Where:** Reports tab.

**Steps**

1. Choose the From and To dates.
2. Read the Sales tiles: totals with and without VAT, cash, card and refunds.
3. Scroll down for sales By day and Top products.
4. Activity by cashier shows discounts, removals, reprints and refunds per person.

**What you should see:** Figures for the dates you chose (Saudi time).

**If something goes wrong**

- *I cannot see this tab.* Your user does not have permission for it. Ask the owner to check your role in Admin → Users.

**Ask a supervisor:** Activity by cashier lists facts for review, not accusations.

<a id="reports-owner"></a>

### Read the owner overview, profit and balances

**What this does:** The owner's summary: sales, profit, cash, what customers owe and what the store owes.

**Where:** Accounting tab.

**Steps**

1. Choose the From and To dates.
2. Owner overview shows sales, gross profit, expenses and net profit for the dates.
3. Money position shows cash and bank, what customers owe the store and what the store owes suppliers right now.
4. Profit and loss, VAT summary and Balance sheet are further down.

**What you should see:** All figures for the chosen dates. "Provisional" means the accountant has not approved the setup yet.

**If something goes wrong**

- *I cannot see this tab.* Your user does not have permission for it. Ask the owner to check your role in Admin → Users.

## Shifts and daily work

<a id="shifts-open"></a>

### Start a shift

**What this does:** Count the cash in the drawer and start selling.

**Where:** Sell tab (when no shift is open).

**Steps**

1. Count the cash in the drawer.
2. Type it in "Opening cash float (SAR)".
3. Press Open shift.

**What you should see:** The sell screen opens with an empty bill.

<a id="shifts-cash-in-out"></a>

### Record cash put in or taken out of the drawer

**What this does:** Record any cash added to or removed from the drawer that is not a sale.

**Where:** Shift tab → Cash in / out.

**Steps**

1. Choose Out or In.
2. Type the amount and the reason.
3. Press Record.

**What you should see:** "Recorded" and Expected cash in drawer changes.

<a id="shifts-close"></a>

### Close a shift and check the cash

**What this does:** Count the drawer at the end of the shift and compare it with what the system expects.

**Where:** Shift tab.

**Steps**

1. Look at "Expected cash in drawer".
2. Count all the cash in the drawer.
3. Type it in "Counted cash in drawer (SAR)".
4. Press Close shift.

**What you should see:** "Shift closed. Expected …, counted …, difference …".

**If something goes wrong**

- *There is a difference.* Count again before closing. If it is still different, tell a supervisor. The difference is recorded.

**Ask a supervisor:** A supervisor should look at every difference the same day.

<a id="shifts-mistakes"></a>

### Find a mistake or ask for authorisation

**What this does:** What to do when something went wrong, and how a supervisor approves.

**Steps**

1. Read the message on the screen. Red means nothing was saved. Green means it was saved.
2. If you are unsure whether a sale was saved, press Reprint last receipt (copy) or ask a supervisor to check Reports before taking money again.
3. When a box asks for a supervisor, the supervisor types their own username and PIN. Never type theirs yourself.

**What you should see:** The supervisor's name is recorded with the approval.

## Backup and recovery

<a id="backup-run"></a>

### Make a backup and check it worked

**What this does:** Save a protected copy of the store's data.

**Where:** Admin tab → Backup.

**Steps**

1. The first time, the owner presses Set up backup key and writes the recovery code on paper. Keep the paper away from the computer.
2. Press Back up now.
3. Check "Last verified local backup" shows the current time.
4. The dot in the top bar also shows how old the last backup is.

**What you should see:** "Backup saved: …" appears.

**If something goes wrong**

- *"Backup not set up"* An administrator must set up the backup key first.

**Ask a supervisor:** Backups and the recovery code are the owner's responsibility.

<a id="backup-restore"></a>

### Restore a backup

**What this does:** Bring the store's data back from a backup file, for example on a new computer.

**Where:** Admin tab → Restore from backup.

**Steps**

1. Only the owner or an administrator should do this.
2. On a new computer, type the recovery code from the paper.
3. Press "Choose backup file and check it" and choose the file.
4. Read the check: date, last invoice and counts.
5. Press Restore this backup only if it is the right one. The app restarts.

**What you should see:** After the restart, the data matches the backup.

**Ask a supervisor:** Restoring replaces the current data. Cashiers must not do this.

<a id="backup-frozen"></a>

### The computer stops responding

**What this does:** What to do if the till freezes or the power goes off.

**Steps**

1. Wait a moment. Do not press keys again and again.
2. If nothing changes, close the app and open it again, or restart the computer.
3. Log in and check the last sale with Reprint last receipt (copy) before taking money again.
4. Tell a supervisor what happened.

**What you should see:** Sales that showed "SAVED" are kept. A sale that was not saved can be entered again.

**Ask a supervisor:** Only the owner restores backups.

## Real situations, step by step

<a id="scenario-a-normal-sale"></a>

### A. A customer pays normally

**What this does:** From the first item to the printed receipt.

**Where:** Sell tab.

**Keys:** `Enter` `Shift+Enter` `Ctrl+Enter`

**Steps**

1. Scan each item, or type the first letters of its name and press Enter.
2. Check the quantities. Use + or − if needed.
3. Tell the customer the total.
4. Press Enter (or Shift+Enter) on the empty search box to open the payment step.
5. Type the cash received and press Enter, or press Ctrl+Enter after the card terminal shows APPROVED.
6. Give the receipt and the change shown on screen.

**What you should see:** A green "SAVED" message, a printed receipt and an empty bill.

<a id="scenario-b-credit"></a>

### B. A customer buys on credit

**What this does:** Selling to a trusted customer who pays later.

**Where:** Sell tab.

**Steps**

1. Type the customer's phone in the Customer box and press Enter.
2. Check Owes now and Available in the credit box.
3. Add the items.
4. If they pay part now, type it in Cash received.
5. Press Credit (rest on account). If over the limit, a supervisor approves with their username and PIN.
6. Give the customer the receipt. It shows the amount on account.

**What you should see:** The sale is saved and the customer's balance goes up.

<a id="scenario-c-part-payment"></a>

### C. A customer pays part of what they owe

**What this does:** Taking part of a customer's debt.

**Where:** Customers tab.

**Steps**

1. Find the customer and open their account.
2. Look at Owed now and the list of credit invoices.
3. In Receive a payment, type the amount and the method.
4. Press "Suggest: oldest first" and check the amounts.
5. Press Record payment.
6. Check that Owed now went down by the amount paid, and tell the customer what is still owed.

**What you should see:** The oldest invoices show Paid or Partially paid.

<a id="scenario-d-return"></a>

### D. A customer returns goods

**What this does:** Taking back goods with the receipt.

**Where:** Refund tab.

**Steps**

1. Ask for the receipt and type its invoice number. Press Find sale.
2. Type how many of each item come back.
3. Untick Back on shelf for damaged goods.
4. Choose the reason. A supervisor enters their username and PIN.
5. Press the Refund button and give the cash and credit note.

**What you should see:** A credit note prints and the refund appears in Reports.

<a id="scenario-e-supplier-later"></a>

### E. A supplier delivers and wants payment later

**What this does:** Receiving goods now and recording what the store owes.

**Steps**

1. Stock tab → Receive goods: choose the supplier, add each product with quantity and cost, press Save receipt.
2. Purchases tab → Enter a supplier invoice: choose the supplier and tick the receipt.
3. Type the invoice details. Leave "Paid now" blank.
4. Press Save supplier invoice.
5. Check "What we owe suppliers": the amount is there.

**What you should see:** Stock went up and the supplier's balance shows the amount owed.

<a id="scenario-f-supplier-part"></a>

### F. A supplier is paid part of the bill

**What this does:** Paying some of what the store owes a supplier.

**Where:** Purchases tab → Pay a supplier.

**Steps**

1. Choose the supplier.
2. Type the amount, the date and how it is paid.
3. Press "Suggest: oldest first", or type the amount for the invoice you are paying.
4. Press Record payment.
5. Check the new balance under "What we owe suppliers".

**What you should see:** The paid invoice shows Partially paid or Paid.

<a id="scenario-g-wrong-qty"></a>

### G. The cashier scanned the wrong quantity

**What this does:** Correcting a quantity before payment.

**Where:** Sell tab.

**Keys:** `+` `−` `Enter`

**Steps**

1. Too many: press − on the line, or press − on the empty search box for the last item.
2. Too few: press + on the line, or scan again.
3. Or click the quantity, type the right number and press Enter.
4. If the line disappears by mistake, press Undo.
5. Check the total before payment.

**What you should see:** The quantity and total are right.

<a id="scenario-h-cannot-find"></a>

### H. The cashier cannot find a product

**What this does:** Ways to find a product that does not come up.

**Where:** Sell tab.

**Steps**

1. Scan the barcode again, slowly and flat under the scanner.
2. Type the barcode numbers and press Enter.
3. Type the first letter or two of the name and look at the suggestions.
4. Try the Arabic name, or another name customers use.
5. Weighed goods need a scale label.
6. If it still cannot be found, ask a supervisor. Do not sell it under another product.

**What you should see:** The product appears in the bill.

<a id="scenario-i-wrong-product"></a>

### I. The cashier picked the wrong product

**What this does:** Taking off a wrong item and adding the right one.

**Where:** Sell tab.

**Steps**

1. Press ✕ on the wrong line, or press − until it is removed.
2. Add the right product.
3. Check every line and the total before payment.

**What you should see:** Only the right items are on the bill.

<a id="scenario-j-day"></a>

### J. A manager checks the day's performance

**What this does:** Looking at today's sales, money collected, and what is owed both ways.

**Steps**

1. Reports tab: choose today, read sales, cash, card, refunds and Activity by cashier.
2. Accounting tab → Owner overview: profit, expenses and Money position for today.
3. Customers tab → Ageing: who owes the store and how late.
4. Purchases tab → What we owe suppliers.
5. Shift tab: expected cash in the drawer.

**What you should see:** A clear picture of the day. Profit figures are provisional until the accountant approves the setup.
