// Example docspawner template: an invoice.
// Data contract: the data comes from data.json.
// Money is in integer cents, so totals never suffer from floating-point rounding.
// It uses the allowlisted packages: lilaq (spend chart) and tiaoma (SEPA payment QR code, EPC standard).

#import "@preview/lilaq:0.6.0" as lq
#import "@preview/tiaoma:0.4.0"

#let data = json("data.json")

#let ink = rgb("#1b2333")
#let accent = rgb("#1e3a8a")
#let muted = rgb("#5b6472")
#let rule = rgb("#d5d9e0")
#let soft = rgb("#f1f5f9")

#set document(title: "Invoice " + data.number, author: data.seller.name)
#set text(font: "Libertinus Serif", size: 9.5pt, fill: ink)
#set table(
  stroke: (x, y) => if y == 0 { (bottom: 1pt + accent) } else { (bottom: 0.3pt + rule) },
  inset: (x: 5pt, y: 3.5pt),
)
#show table.cell.where(y: 0): set text(weight: "bold")

// --- Money and dates ------------------------------------------------------------

/// Format cents as "26,152.20".
#let amount(cents) = {
  let c = calc.abs(cents)
  let whole = str(calc.quo(c, 100))
  let frac = calc.rem(c, 100)
  let groups = ()
  while whole.len() > 3 {
    groups.insert(0, whole.slice(whole.len() - 3))
    whole = whole.slice(0, whole.len() - 3)
  }
  groups.insert(0, whole)
  let sign = if cents < 0 { "−" } else { "" }
  sign + groups.join(",") + "." + (if frac < 10 { "0" } else { "" }) + str(frac)
}
#let money(cents) = data.currency + " " + amount(cents)

/// Plain amount for machines, for example "26152.20".
#let plain-amount(cents) = {
  let frac = calc.rem(cents, 100)
  str(calc.quo(cents, 100)) + "." + (if frac < 10 { "0" } else { "" }) + str(frac)
}

#let parse-date(text) = {
  let (y, m, d) = text.split("-").map(int)
  datetime(year: y, month: m, day: d)
}
#let show-date(date) = date.display("[year]-[month]-[day]")

// --- Calculations -----------------------------------------------------------------

#let line-cents(item) = item.quantity * item.unitPriceCents
#let categories = ("Engineering", "Review", "Infrastructure", "Training", "Licenses").filter(c => data.items.any(i => i.category == c))
#let category-net = categories.map(c => data.items.filter(i => i.category == c).map(line-cents).sum())

#let rates = data.items.map(i => i.taxRate).dedup().sorted()
#let rate-net = rates.map(r => data.items.filter(i => i.taxRate == r).map(line-cents).sum())
// VAT per rate, rounded half up to the cent.
#let rate-vat = rates.zip(rate-net).map(((r, net)) => int(calc.round(net * r / 100)))
#let net-total = rate-net.sum()
#let vat-total = rate-vat.sum()
#let gross-total = net-total + vat-total

#let issued = parse-date(data.issueDate)
#let due = issued + duration(days: data.paymentTermsDays)
#let early-date = issued + duration(days: data.earlyPayment.days)
#let early-discount = int(calc.round(gross-total * data.earlyPayment.percent / 100))

// SEPA credit transfer QR code (EPC069-12, "GiroCode"): fixed line order, version 002, UTF-8.
#let epc-payload = (
  "BCD",
  "002",
  "1",
  "SCT",
  data.seller.bic,
  data.seller.name,
  data.seller.iban,
  data.currency + plain-amount(gross-total),
  "",
  "",
  "Invoice " + data.number,
).join("\n")

#let iban-groups(iban) = iban.clusters().chunks(4).map(c => c.join()).join(" ")

// --- Page -------------------------------------------------------------------------

#set page(
  paper: "a4",
  margin: (x: 2cm, top: 2cm, bottom: 2.2cm),
  header: context {
    if counter(page).get().first() > 1 {
      set text(8pt, fill: muted)
      grid(columns: (1fr, auto), [#data.seller.name · Invoice #data.number], [Due #show-date(due)])
      v(-4pt)
      line(length: 100%, stroke: 0.4pt + rule)
    }
  },
  footer: context {
    set text(7.5pt, fill: muted)
    grid(
      columns: (1fr, auto),
      [#data.seller.name · VAT #data.seller.vatId · #data.seller.email · example data],
      [Page #counter(page).display() of #counter(page).final().first()],
    )
  },
)

#let card(title, body) = block(width: 100%, inset: 9pt, radius: 4pt, fill: soft, [
  #text(7.5pt, fill: muted, upper(title)) \ #body
])

// --- Summary page -----------------------------------------------------------------

#grid(
  columns: (1fr, auto),
  [
    #text(16pt, weight: "bold", data.seller.name) \
    #data.seller.address \
    #data.seller.email · VAT #data.seller.vatId
  ],
  align(right)[
    #text(24pt, weight: "bold", fill: accent)[INVOICE] \
    *No.* #data.number \
    *Issued* #show-date(issued) \
    *PO* #data.customer.purchaseOrder
  ],
)

#v(10pt)
#grid(
  columns: (1fr, 1fr, 1fr),
  column-gutter: 8pt,
  card("Bill to", [*#data.customer.name* \ #data.customer.address \ VAT #data.customer.vatId]),
  card("Amount due", [#text(16pt, weight: "bold", fill: accent, money(gross-total)) \ by #show-date(due) (#data.paymentTermsDays days)]),
  card("Pay early", [#text(13pt, weight: "bold")[#money(gross-total - early-discount)] \ by #show-date(early-date): #data.earlyPayment.percent % off (#money(early-discount))]),
)

#v(8pt)
#grid(
  columns: (1fr, 1fr),
  column-gutter: 16pt,
  [
    #text(9pt, weight: "bold", fill: accent)[VAT BREAKDOWN]
    #table(
      columns: (auto, 1fr, 1fr, 1fr),
      align: (left, right, right, right),
      table.header([Rate], [Net], [VAT], [Gross]),
      ..rates.zip(rate-net, rate-vat).map(((r, net, vat)) => ([#r %], amount(net), amount(vat), amount(net + vat))).flatten(),
      [*Total*], [*#amount(net-total)*], [*#amount(vat-total)*], [*#amount(gross-total)*],
    )
    #text(7.5pt, fill: muted)[Amounts in #data.currency. VAT is rounded once per rate, half up to the cent.]
  ],
  [
    #text(9pt, weight: "bold", fill: accent)[SPEND BY CATEGORY (NET)]
    #lq.diagram(
      width: 7.6cm,
      height: 4.3cm,
      xlabel: [Thousand #data.currency],
      yaxis: (ticks: categories.enumerate().map(((i, c)) => (i, c)), mirror: false),
      xaxis: (mirror: false),
      lq.hbar(category-net.map(c => c / 100000), range(categories.len()), fill: accent.lighten(25%)),
    )
  ],
)

#v(6pt)
#block(width: 100%, inset: 12pt, radius: 4pt, stroke: 0.8pt + accent, grid(
  columns: (auto, 1fr),
  column-gutter: 16pt,
  align: horizon,
  tiaoma.qrcode(epc-payload, width: 3cm),
  [
    #text(9pt, weight: "bold", fill: accent)[PAY BY BANK TRANSFER] \
    #v(2pt)
    #table(
      columns: (auto, 1fr),
      stroke: none,
      inset: (x: 0pt, y: 2pt),
      column-gutter: 10pt,
      text(fill: muted)[Beneficiary], data.seller.name,
      text(fill: muted)[IBAN], raw(iban-groups(data.seller.iban)),
      text(fill: muted)[BIC], raw(data.seller.bic),
      text(fill: muted)[Amount], strong(money(gross-total)),
      text(fill: muted)[Reference], [Invoice #data.number],
    )
    #text(7.5pt, fill: muted)[The QR code follows the EPC SEPA credit transfer standard (GiroCode): a banking app fills in the transfer.]
  ],
))

#v(1fr)
#text(8.5pt)[#data.notes]

#pagebreak()

// --- Line items -------------------------------------------------------------------

#text(12pt, weight: "bold", fill: accent)[Line items]
#v(2pt)
#let row-number = state("row", 0)
#table(
  columns: (auto, 1fr, auto, auto, auto, auto),
  align: (right, left, right, right, right, right),
  table.header([\#], [Description], [Qty], [Unit price], [VAT], [Amount]),
  ..categories.zip(category-net).map(((c, net)) => {
    let items = data.items.filter(i => i.category == c)
    (
      table.cell(colspan: 6, fill: soft, align: left, text(weight: "bold", fill: accent, c)),
      ..items.enumerate().map(((i, item)) => (
        str(data.items.position(x => x == item) + 1),
        item.description,
        [#item.quantity #item.unit],
        amount(item.unitPriceCents),
        [#item.taxRate %],
        amount(line-cents(item)),
      )).flatten(),
      table.cell(colspan: 5, align: right, text(fill: muted)[Subtotal #c]),
      text(weight: "bold", amount(net)),
    )
  }).flatten(),
  table.cell(colspan: 5, align: right)[*Net total*], [*#amount(net-total)*],
  table.cell(colspan: 5, align: right)[VAT], amount(vat-total),
  table.cell(colspan: 5, align: right)[*Amount due (#data.currency)*], text(weight: "bold", fill: accent, amount(gross-total)),
)
