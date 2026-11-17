// Example docspawner template: a cold-chain shipment report for temperature-sensitive medicines.
// Data contract: the data comes from data.json.
// The chart and the statistics are computed in Typst. The template needs no packages.

#let data = json("data.json")
#let temp = data.temperature
#let values = temp.readings.map(r => r.celsius)

#let ink = rgb("#1f2937")
#let accent = rgb("#0e7490")
#let muted = rgb("#6b7280")
#let line-color = rgb("#d1d5db")
#let pass = rgb("#15803d")
#let fail = rgb("#b91c1c")

// --- Statistics -----------------------------------------------------------------

#let t-min = calc.min(..values)
#let t-max = calc.max(..values)
#let t-mean = values.sum() / values.len()

/// Mean kinetic temperature (MKT), in °C. Uses ΔH/R = 10,000 K (ΔH = 83.144 kJ/mol).
#let mkt = {
  let dh-r = 10000
  let kelvin = values.map(c => c + 273.15)
  let mean-exp = kelvin.map(k => calc.exp(-dh-r / k)).sum() / kelvin.len()
  dh-r / -calc.ln(mean-exp) - 273.15
}

#let outside = temp.readings.filter(r => r.celsius < temp.min or r.celsius > temp.max)
#let minutes-outside = outside.len() * temp.intervalMinutes
#let in-range = outside.len() == 0

#let fmt(value) = str(calc.round(value, digits: 1)) + " °C"

// --- Page -----------------------------------------------------------------------

#set document(title: "Cold-chain shipment report " + data.document.number, author: data.company.name)
#set text(size: 9pt, fill: ink)
#set page(
  paper: "a4",
  margin: (x: 1.8cm, top: 1.6cm, bottom: 2cm),
  footer: context {
    set text(7.5pt, fill: muted)
    grid(
      columns: (1fr, auto),
      [#data.company.name · #data.document.number],
      [Page #counter(page).display() of #counter(page).final().first()],
    )
  },
)

#let section(title) = block(above: 1.4em, below: 0.6em, text(9pt, weight: "bold", fill: accent, upper(title)))

#let badge(ok, yes, no) = box(
  inset: (x: 5pt, y: 2pt),
  radius: 2pt,
  fill: if ok { pass } else { fail },
  text(7.5pt, weight: "bold", fill: white, if ok { yes } else { no }),
)

#let key-values(..pairs) = table(
  columns: (auto, 1fr),
  column-gutter: 12pt,
  stroke: none,
  inset: (x: 0pt, y: 3pt),
  ..pairs.pos().map(((k, v)) => (text(fill: muted, k), v)).flatten(),
)

// --- Chart: temperature log with the allowed range ------------------------------

#let temperature-chart = {
  let (w, h) = (420pt, 130pt)
  let hours = temp.readings.last().hour
  let (y-low, y-high) = (0, 12)
  let x(hour) = hour / hours * w
  let y(celsius) = h - (celsius - y-low) / (y-high - y-low) * h
  let seg(a, b, stroke) = place(line(start: a, end: b, stroke: stroke))

  box(width: w + 34pt, height: h + 38pt, pad(left: 30pt, top: 8pt, box(width: w, height: h, {
    // Allowed range, shaded.
    place(dy: y(temp.max), rect(width: w, height: y(temp.min) - y(temp.max), fill: rgb("#ecfdf5")))
    for limit in (temp.min, temp.max) {
      seg((0pt, y(limit)), (w, y(limit)), (paint: pass, thickness: 0.7pt, dash: "dashed"))
    }
    place(dx: w - 70pt, dy: y(temp.max) + 3pt, text(7pt, fill: pass)[allowed #temp.min–#temp.max °C])

    // Y-axis labels.
    for c in (0, 2, 4, 6, 8, 10, 12) {
      seg((0pt, y(c)), (-3pt, y(c)), 0.4pt + muted)
      place(dx: -28pt, dy: y(c) - 4pt, box(width: 22pt, align(right, text(7pt, fill: muted)[#c °C])))
    }
    // X-axis labels, every 6 hours.
    seg((0pt, h), (w, h), 0.4pt + muted)
    for hour in range(0, hours + 1, step: 6) {
      place(dx: x(hour) - 10pt, dy: h + 4pt, box(width: 20pt, align(center, text(7pt, fill: muted)[#hour h])))
    }
    place(dx: w / 2 - 50pt, dy: h + 15pt, box(width: 100pt, align(center, text(7pt, fill: muted)[hours since departure])))

    // Readings.
    for (a, b) in temp.readings.windows(2) {
      seg((x(a.hour), y(a.celsius)), (x(b.hour), y(b.celsius)), 1.3pt + accent)
    }
    for r in temp.readings {
      let ok = r.celsius >= temp.min and r.celsius <= temp.max
      place(dx: x(r.hour) - 1.8pt, dy: y(r.celsius) - 1.8pt, circle(radius: 1.8pt, fill: if ok { accent } else { fail }))
    }

    // Mark the highest reading.
    let top = temp.readings.find(r => r.celsius == t-max)
    place(dx: x(top.hour) + 6pt, dy: y(top.celsius) - 2pt, text(7pt, fill: ink)[max #fmt(t-max)])
  })))
}

// --- Document -------------------------------------------------------------------

#grid(
  columns: (1fr, auto),
  align: (left + bottom, right + bottom),
  [
    #text(13pt, weight: "bold", data.company.name) \
    #text(fill: muted)[#data.company.site · #data.company.address]
  ],
  [
    #text(16pt, weight: "bold", fill: accent)[Cold-Chain Shipment Report] \
    #text(fill: muted)[No. #data.document.number · issued #data.document.issued]
  ],
)
#line(length: 100%, stroke: 1pt + accent)

#grid(
  columns: (1fr, 1fr),
  column-gutter: 20pt,
  [
    #section[Route]
    #key-values(
      ([From], data.shipment.from),
      ([To], data.shipment.to),
      ([Carrier], data.shipment.carrier),
    )
  ],
  [
    #section[Transport]
    #key-values(
      ([Departed], data.shipment.departed),
      ([Arrived], data.shipment.arrived),
      ([Packaging], data.shipment.packaging),
      ([Data logger], data.shipment.logger),
    )
  ],
)

#section[Contents]
#table(
  columns: (2.4fr, 1fr, 1fr, auto),
  align: (left, left, left, right),
  inset: (x: 5pt, y: 5pt),
  stroke: (x, y) => if y == 0 { (bottom: 1pt + accent) } else { (bottom: 0.4pt + line-color) },
  table.header(..([Product], [Lot], [Expiry], [Quantity]).map(h => text(weight: "bold", h))),
  ..data.items.map(i => (i.product, i.lot, i.expiry, [#i.quantity #i.unit])).flatten(),
)

#section[Temperature during transport]
#temperature-chart

#grid(
  columns: (1fr,) * 5,
  column-gutter: 8pt,
  ..(
    ([Minimum], fmt(t-min)),
    ([Maximum], fmt(t-max)),
    ([Average], fmt(t-mean)),
    ([MKT], fmt(mkt)),
    ([Time outside #temp.min–#temp.max °C], [#minutes-outside min]),
  ).map(((label, value)) => block(
    width: 100%,
    inset: 7pt,
    radius: 3pt,
    stroke: 0.5pt + line-color,
    [#text(7.5pt, fill: muted, label) \ #text(11pt, weight: "bold", value)],
  )),
)
#text(7.5pt, fill: muted)[
  #temp.readings.len() readings, one every #temp.intervalMinutes min.
  MKT is the mean kinetic temperature, with ΔH = 83.144 kJ/mol.
]

#section[Release decision]
#block(
  width: 100%,
  inset: 8pt,
  radius: 3pt,
  fill: if in-range { rgb("#f0fdf4") } else { rgb("#fef2f2") },
  stroke: 0.6pt + if in-range { pass } else { fail },
  if in-range [
    #badge(true, [RELEASED], []) #h(6pt)
    All readings stayed within #temp.min–#temp.max °C. The goods are released to stock.
  ] else [
    #badge(false, [], [QUARANTINE]) #h(6pt)
    #outside.len() readings were outside #temp.min–#temp.max °C (#minutes-outside min).
    Keep the goods in quarantine until QA completes a stability assessment.
  ],
)

#section[Signatures]
#grid(
  columns: (1fr,) * data.signatures.len(),
  column-gutter: 14pt,
  ..data.signatures.map(s => [
    #v(18pt)
    #line(length: 100%, stroke: 0.5pt + muted)
    #strong(s.name) \
    #text(fill: muted)[#s.role · #s.date]
  ]),
)
