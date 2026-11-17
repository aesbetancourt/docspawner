// Example docspawner template: a cold-chain shipment report for temperature-sensitive medicines.
// Data contract: the data comes from data.json.
// It uses the allowlisted packages: lilaq (charts), fletcher (route) and tiaoma (SSCC, QR).
// Every statistic, the mean kinetic temperature and the release decision are computed here.

#import "@preview/fletcher:0.5.8" as fletcher: node, edge
#import "@preview/lilaq:0.6.0" as lq
#import "@preview/tiaoma:0.4.0"

#let data = json("data.json")
#let temp = data.temperature

#let ink = rgb("#1f2937")
#let accent = rgb("#0e7490")
#let muted = rgb("#6b7280")
#let line-color = rgb("#d1d5db")
#let soft = rgb("#f3f5f8")
#let pass = rgb("#15803d")
#let fail = rgb("#b91c1c")
#let sensor-colors = (rgb("#0f4c81"), rgb("#0e7490"), rgb("#7c3aed"))

#set document(title: "Cold-chain shipment report " + data.document.number, author: data.company.name)
#set text(font: "Libertinus Serif", size: 9pt, fill: ink)
#set page(
  paper: "a4",
  margin: (x: 1.8cm, top: 1.6cm, bottom: 2cm),
  footer: context {
    set text(7.5pt, fill: muted)
    grid(
      columns: (1fr, auto),
      [#data.company.name · #data.document.number · example data],
      [Page #counter(page).display() of #counter(page).final().first()],
    )
  },
)
#set table(
  stroke: (x, y) => if y == 0 { (bottom: 1pt + accent) } else { (bottom: 0.4pt + line-color) },
  inset: (x: 5pt, y: 4pt),
)
#show table.cell.where(y: 0): set text(weight: "bold")

// --- Helpers --------------------------------------------------------------------

#let fmt(value, digits) = str(calc.round(value, digits: digits))
#let mean(xs) = xs.sum() / xs.len()
#let section(title) = block(above: 1.3em, below: 0.6em, text(9pt, weight: "bold", fill: accent, upper(title)))
#let badge(ok, yes: [IN RANGE], no: [OUT OF RANGE]) = box(
  inset: (x: 5pt, y: 2pt),
  radius: 2pt,
  fill: if ok { pass } else { fail },
  text(7pt, weight: "bold", fill: white, if ok { yes } else { no }),
)
#let key-values(..pairs) = table(
  columns: (auto, 1fr),
  column-gutter: 10pt,
  stroke: none,
  inset: (x: 0pt, y: 2.5pt),
  ..pairs.pos().map(((k, v)) => (text(fill: muted, k), v)).flatten(),
)

/// Mean kinetic temperature in °C, with ΔH/R = 10,000 K (ΔH = 83.144 kJ/mol).
#let mkt(values) = {
  let dh-r = 10000
  let mean-exp = values.map(c => calc.exp(-dh-r / (c + 273.15))).sum() / values.len()
  dh-r / -calc.ln(mean-exp) - 273.15
}

/// GS1 check digit (mod 10, weights 3 and 1 from the right).
#let gs1-check-digit(body) = {
  let digits = body.clusters().rev().map(int)
  let total = digits.enumerate().map(((i, d)) => if calc.even(i) { 3 * d } else { d }).sum()
  calc.rem(10 - calc.rem(total, 10), 10)
}

#let in-range(c) = c >= temp.min and c <= temp.max

// --- Derived values -------------------------------------------------------------

#let hours = range(temp.sensors.first().readings.len())
#let all-readings = temp.sensors.map(s => s.readings).flatten()
#let minutes-out(values) = values.filter(c => not in-range(c)).len() * temp.intervalMinutes
#let shipment-ok = all-readings.all(in-range)

/// Readings of every sensor between two hours, both included.
#let leg-readings(leg) = temp.sensors.map(s => s.readings.slice(leg.fromHour, leg.toHour + 1)).flatten()
#let leg-summary(leg) = {
  let values = leg-readings(leg)
  [#fmt(calc.min(..values), 1)–#fmt(calc.max(..values), 1) °C · #minutes-out(values) min out]
}

// Histogram of all readings in 0.5 °C bins.
#let bin-width = 0.5
#let bin-starts = range(4, 22).map(i => i * bin-width)
#let bin-counts = bin-starts.map(b => all-readings.filter(c => c >= b and c < b + bin-width).len())
#let bin-hours = bin-counts.map(n => n * temp.intervalMinutes / 60)

// --- Header -----------------------------------------------------------------------

#grid(
  columns: (1fr, auto),
  column-gutter: 12pt,
  align: (left + bottom, center + bottom),
  [
    #text(13pt, weight: "bold", data.company.name) \
    #text(fill: muted)[#data.company.site · #data.company.address] \
    #v(4pt)
    #text(17pt, weight: "bold", fill: accent)[Cold-Chain Shipment Report] \
    #text(fill: muted)[No. #data.document.number · issued #data.document.issued]
  ],
  [
    #tiaoma.qrcode(data.shipment.loggerUrl, width: 1.9cm)
    #text(6.5pt, fill: muted)[Logger data]
  ],
)
#line(length: 100%, stroke: 1pt + accent)

#grid(
  columns: (1fr, 1fr),
  column-gutter: 20pt,
  [
    #section[Shipment]
    #key-values(
      ([From], data.shipment.from),
      ([To], data.shipment.to),
      ([Carrier], data.shipment.carrier),
      ([Packaging], data.shipment.packaging),
    )
  ],
  [
    #section[Monitoring]
    #key-values(
      ([Departed], data.shipment.departed),
      ([Arrived], data.shipment.arrived),
      ([Data logger], data.shipment.logger),
      ([Sensors], [#temp.sensors.len() on the pallet, one every #temp.intervalMinutes min]),
    )
  ],
)

#section[Route · temperature per leg (all sensors)]
#align(center, fletcher.diagram(
  spacing: (34mm, 10mm),
  node-stroke: 0.7pt + accent,
  node-fill: soft,
  node-corner-radius: 3pt,
  edge-stroke: 0.8pt + ink,
  ..data.route.enumerate().map(((i, stop)) => {
    let dock = data.legs.find(l => l.from == stop.id and l.to == stop.id)
    node(
      (i, 0),
      [
        #text(8.5pt, weight: "bold", stop.place) \
        #text(7pt, fill: muted, stop.time)
        #if dock != none [\ #text(7pt)[#dock.name: #leg-summary(dock)]]
      ],
      name: label(stop.id),
      width: 40mm,
    )
  }),
  ..data.legs.filter(l => l.from != l.to).map(l => edge(
    label(l.from),
    label(l.to),
    "-|>",
    text(7pt)[#l.name \ #leg-summary(l)],
    label-side: left,
  )),
))

#section[Temperature during transport]
#align(center, lq.diagram(
  width: 17cm,
  height: 6cm,
  xlabel: [Hours since departure],
  ylabel: [Temperature (°C)],
  ylim: (0, 22),
  xlim: (0, hours.last()),
  legend: (position: top + right),
  lq.fill-between(hours, hours.map(_ => temp.min), y2: hours.map(_ => temp.max), fill: pass.transparentize(88%), label: [Allowed #temp.min–#temp.max °C]),
  lq.plot(hours, temp.ambient, mark: none, color: muted, stroke: (dash: "dashed", thickness: 0.6pt), label: [Ambient]),
  ..temp.sensors.zip(sensor-colors).map(((s, color)) => lq.plot(hours, s.readings, mark: none, color: color, label: s.position)),
  ..data.legs.map(l => lq.vlines(l.toHour, stroke: (paint: line-color, dash: "dotted"))),
))

#grid(
  columns: (1.2fr, 1fr),
  column-gutter: 16pt,
  [
    #section[Statistics per sensor]
    #table(
      columns: (1.3fr, 1fr, 1fr, 1fr, 1fr, auto),
      align: (left, right, right, right, right, center),
      table.header([Sensor], [Min], [Max], [Mean], [MKT], [Status]),
      ..temp.sensors.map(s => (
        [#s.position \ #text(7pt, fill: muted, raw(s.id))],
        fmt(calc.min(..s.readings), 1),
        fmt(calc.max(..s.readings), 1),
        fmt(mean(s.readings), 1),
        fmt(mkt(s.readings), 1),
        badge(s.readings.all(in-range)),
      )).flatten(),
    )
    #text(7.5pt, fill: muted)[Values in °C. MKT is the mean kinetic temperature with ΔH = 83.144 kJ/mol.]
  ],
  [
    #section[Time at each temperature]
    #lq.diagram(
      width: 7cm,
      height: 4.2cm,
      xlabel: [°C (0.5 °C bins)],
      ylabel: [Sensor-hours],
      lq.bar(
        bin-starts.map(b => b + bin-width / 2),
        bin-hours,
        width: bin-width * 0.9,
        fill: bin-starts.map(b => if in-range(b) and in-range(b + bin-width) { accent } else { fail }),
      ),
    )
  ],
)

#pagebreak()
#section[Pallets]
#grid(
  columns: (1fr, 1fr),
  column-gutter: 14pt,
  ..data.pallets.map(p => {
    let sscc = p.ssccBody + str(gs1-check-digit(p.ssccBody))
    block(width: 100%, inset: 8pt, radius: 3pt, stroke: 0.5pt + line-color, [
      #tiaoma.gs1-128("[00]" + sscc, width: 100%, height: 1.2cm)
      #text(7.5pt)[SSCC (00) #raw(sscc) · #p.contents]
    ])
  }),
)

#section[Contents]
#table(
  columns: (2.4fr, 1fr, 1fr, auto),
  align: (left, left, left, right),
  table.header([Product], [Lot], [Expiry], [Quantity]),
  ..data.items.map(i => (i.product, i.lot, i.expiry, [#i.quantity #i.unit])).flatten(),
)

#section[Release decision]
#block(
  width: 100%,
  inset: 8pt,
  radius: 3pt,
  fill: if shipment-ok { rgb("#f0fdf4") } else { rgb("#fef2f2") },
  stroke: 0.6pt + if shipment-ok { pass } else { fail },
  if shipment-ok [
    #badge(true, yes: [RELEASED]) #h(6pt)
    All #all-readings.len() readings from #temp.sensors.len() sensors stayed within #temp.min–#temp.max °C. The goods are released to stock.
  ] else [
    #badge(false, no: [QUARANTINE]) #h(6pt)
    #all-readings.filter(c => not in-range(c)).len() readings were outside #temp.min–#temp.max °C (#minutes-out(all-readings) sensor-minutes).
    Keep the goods in quarantine until QA completes a stability assessment.
  ],
)

#section[Signatures]
#grid(
  columns: (1fr,) * data.signatures.len(),
  column-gutter: 14pt,
  ..data.signatures.map(s => [
    #v(14pt)
    #line(length: 100%, stroke: 0.5pt + muted)
    #strong(s.name) \
    #text(fill: muted)[#s.role · #s.date]
  ]),
)
