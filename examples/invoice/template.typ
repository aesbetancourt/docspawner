// Example docspawner template: an invoice.
// Data contract: the data comes from data.json.

#let data = json("data.json")

#let money(amount) = {
  let cents = int(calc.round(amount * 100))
  let frac = calc.rem(cents, 100)
  data.currency + " " + str(calc.quo(cents, 100)) + "." + (if frac < 10 { "0" } else { "" }) + str(frac)
}

#let subtotal = data.items.map(item => item.quantity * item.unitPrice).sum(default: 0)
#let tax = subtotal * data.taxRate
#let total = subtotal + tax

#set document(title: "Invoice " + data.number, author: data.seller.name)
#set text(size: 10pt)
#set page(
  paper: "a4",
  margin: (x: 2cm, top: 2cm, bottom: 2.5cm),
  footer: context align(center, text(8pt, fill: gray)[
    #data.seller.name · Invoice #data.number · Page #counter(page).display() of #counter(page).final().first()
  ]),
)

#grid(
  columns: (1fr, auto),
  [
    #text(16pt, weight: "bold", data.seller.name) \
    #data.seller.address \
    #data.seller.email
  ],
  align(right)[
    #text(22pt, weight: "bold", fill: rgb("#1e3a8a"))[INVOICE] \
    *No.* #data.number \
    *Date:* #data.date \
    *Due:* #data.dueDate
  ],
)

#v(1em)
#block(fill: rgb("#f1f5f9"), inset: 10pt, radius: 4pt, width: 100%)[
  *Bill to* \
  #data.customer.name \
  #data.customer.address
]
#v(1em)

#table(
  columns: (auto, 1fr, auto, auto, auto),
  align: (right, left, right, right, right),
  stroke: (x, y) => if y == 0 { (bottom: 1pt) } else { (bottom: 0.3pt + luma(200)) },
  table.header([*\#*], [*Description*], [*Qty*], [*Unit price*], [*Amount*]),
  ..data.items.enumerate().map(((i, item)) => (
    str(i + 1),
    item.description,
    str(item.quantity),
    money(item.unitPrice),
    money(item.quantity * item.unitPrice),
  )).flatten(),
)

#align(right, block(width: 45%)[
  #grid(
    columns: (1fr, auto),
    column-gutter: 12pt,
    row-gutter: 6pt,
    [Subtotal], money(subtotal),
    [Tax (#str(data.taxRate * 100)%)], money(tax),
    grid.hline(stroke: 0.6pt),
    text(weight: "bold")[Total], text(weight: "bold", money(total)),
  )
])

#if "notes" in data [
  #v(1.5em)
  *Notes* \
  #data.notes
]
