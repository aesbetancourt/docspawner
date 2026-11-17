// Example docspawner template: a Certificate of Analysis for a pharmaceutical batch.
// Data contract: the data comes from data.json.
// Everything is drawn with built-in Typst shapes, so the template needs no packages.

#let data = json("data.json")

#let ink = rgb("#1f2937")
#let accent = rgb("#0f4c81")
#let muted = rgb("#6b7280")
#let line-color = rgb("#d1d5db")
#let pass = rgb("#15803d")
#let fail = rgb("#b91c1c")

#set document(title: "Certificate of Analysis " + data.document.number, author: data.company.name)
#set text(size: 9pt, fill: ink)
#set page(
  paper: "a4",
  margin: (x: 1.8cm, top: 1.6cm, bottom: 2cm),
  footer: context {
    set text(7.5pt, fill: muted)
    grid(
      columns: (1fr, auto),
      [#data.company.name · #data.document.number · version #data.document.version],
      [Page #counter(page).display() of #counter(page).final().first()],
    )
  },
)

// --- Helpers --------------------------------------------------------------------

/// A chemical formula with subscripts, for example C₈H₉NO₂.
#let formula(parts) = {
  parts.map(((element, count)) => if count > 1 [#element#sub[#str(count)]] else [#element]).join()
}

/// A small label for a section.
#let section(title) = block(above: 1.4em, below: 0.6em, text(9pt, weight: "bold", fill: accent, upper(title)))

/// A pass or fail marker.
#let badge(ok) = box(
  inset: (x: 5pt, y: 2pt),
  radius: 2pt,
  fill: if ok { pass } else { fail },
  text(7.5pt, weight: "bold", fill: white, if ok [PASS] else [FAIL]),
)

// --- Molecule: paracetamol, drawn from lines -------------------------------------

#let molecule = {
  let bond(a, b) = place(line(start: a, end: b, stroke: 1.1pt + ink))
  // An atom label on a white background, so it hides the end of its bond.
  let atom(x, y, label) = place(
    dx: x * 1pt - 11pt,
    dy: y * 1pt - 6pt,
    box(width: 22pt, height: 12pt, fill: white, align(center + horizon, text(8.5pt, label))),
  )

  // Benzene ring: six corners around the center (60, 64), pointy at the top.
  let (cx, cy, r) = (60, 64, 26)
  let corner(i) = {
    let a = -90deg + i * 60deg
    (cx + r * calc.cos(a), cy + r * calc.sin(a))
  }
  let pt((x, y)) = (x * 1pt, y * 1pt)
  // Point between the center and a corner, for the inner line of a double bond.
  let inner(i, k) = {
    let (x, y) = corner(i)
    (cx + k * (x - cx), cy + k * (y - cy))
  }

  box(width: 130pt, height: 165pt, {
    for i in range(6) { bond(pt(corner(i)), pt(corner(calc.rem(i + 1, 6)))) }
    // Three double bonds inside the ring.
    for i in (0, 2, 4) {
      let j = calc.rem(i + 1, 6)
      let (a, b) = (inner(i, 0.72), inner(j, 0.72))
      let mid(p, q, t) = (p.at(0) + t * (q.at(0) - p.at(0)), p.at(1) + t * (q.at(1) - p.at(1)))
      bond(pt(mid(a, b, 0.15)), pt(mid(a, b, 0.85)))
    }

    // OH on the top corner.
    let (tx, ty) = corner(0)
    bond(pt((tx, ty)), pt((tx, ty - 20)))
    atom(tx, ty - 26, [OH])

    // NH–C(=O)–CH3 on the bottom corner.
    let (bx, by) = corner(3)
    let (nx, ny) = (bx, by + 22)
    let (ccx, ccy) = (nx + 22, ny + 13)
    bond(pt((bx, by)), pt((nx, ny)))
    bond(pt((nx, ny)), pt((ccx, ccy)))
    // C=O double bond.
    bond(pt((ccx, ccy)), pt((ccx + 20, ccy - 12)))
    bond(pt((ccx + 2.5, ccy + 4)), pt((ccx + 22.5, ccy - 8)))
    bond(pt((ccx, ccy)), pt((ccx, ccy + 24)))
    atom(nx, ny, [HN])
    atom(ccx + 24, ccy - 14, [O])
    atom(ccx, ccy + 29, [CH#sub[3]])
  })
}

// --- Chart: dissolution profile, drawn from lines -------------------------------

#let dissolution-chart(points, limit) = {
  let (w, h) = (250pt, 120pt)
  let (x-max, y-max) = (45, 100)
  let x(minutes) = minutes / x-max * w
  let y(percent) = h - percent / y-max * h
  let seg(a, b, stroke) = place(line(start: a, end: b, stroke: stroke))

  box(width: w + 34pt, height: h + 30pt, pad(left: 28pt, box(width: w, height: h, {
    // Grid and y-axis labels.
    for p in (0, 20, 40, 60, 80, 100) {
      seg((0pt, y(p)), (w, y(p)), 0.4pt + line-color)
      place(dx: -26pt, dy: y(p) - 4pt, box(width: 22pt, align(right, text(7pt, fill: muted)[#p %])))
    }
    // X-axis labels.
    for m in (0, 5, 10, 15, 20, 30, 45) {
      place(dx: x(m) - 10pt, dy: h + 4pt, box(width: 20pt, align(center, text(7pt, fill: muted)[#m])))
    }
    place(dx: w / 2 - 30pt, dy: h + 15pt, box(width: 60pt, align(center, text(7pt, fill: muted)[time (min)])))

    // Specification: Q at the limit time.
    seg((x(limit.minutes), 0pt), (x(limit.minutes), h), (paint: fail, thickness: 0.7pt, dash: "dashed"))
    seg((0pt, y(limit.percent)), (w, y(limit.percent)), (paint: fail, thickness: 0.7pt, dash: "dashed"))
    place(
      dx: x(limit.minutes) + 4pt,
      dy: y(limit.percent) + 3pt,
      text(7pt, fill: fail)[Q = #limit.percent % at #limit.minutes min],
    )

    // Mean dissolution curve with markers.
    for (a, b) in points.windows(2) {
      seg((x(a.minutes), y(a.percent)), (x(b.minutes), y(b.percent)), 1.4pt + accent)
    }
    for p in points {
      place(dx: x(p.minutes) - 2.5pt, dy: y(p.percent) - 2.5pt, circle(radius: 2.5pt, fill: accent, stroke: white))
    }
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
    #text(16pt, weight: "bold", fill: accent)[Certificate of Analysis] \
    #text(fill: muted)[No. #data.document.number · issued #data.document.issued]
  ],
)
#line(length: 100%, stroke: 1pt + accent)

#grid(
  columns: (1fr, auto),
  column-gutter: 16pt,
  [
    #section[Product]
    #table(
      columns: (auto, 1fr),
      column-gutter: 12pt,
      stroke: none,
      inset: (x: 0pt, y: 3pt),
      text(fill: muted)[Product], strong(data.product.name),
      text(fill: muted)[Active substance], data.product.substance,
      text(fill: muted)[Molecular formula], formula(data.product.formula),
      text(fill: muted)[Molecular weight], [#data.product.molecularWeight g/mol],
      text(fill: muted)[CAS number], data.product.casNumber,
      text(fill: muted)[Pharmacopoeia], data.product.pharmacopoeia,
    )
    #section[Batch]
    #table(
      columns: (auto, 1fr),
      column-gutter: 12pt,
      stroke: none,
      inset: (x: 0pt, y: 3pt),
      text(fill: muted)[Batch number], strong(data.batch.number),
      text(fill: muted)[Batch size], data.batch.size,
      text(fill: muted)[Manufactured], data.batch.manufactured,
      text(fill: muted)[Expiry], data.batch.expiry,
      text(fill: muted)[Storage], data.batch.storage,
    )
  ],
  [
    #section[Structure]
    #block(stroke: 0.5pt + line-color, radius: 3pt, inset: 6pt, molecule)
  ],
)

#section[Test results]
#let all-pass = data.tests.all(t => t.conforms)
#table(
  columns: (1.4fr, 1fr, 1.4fr, 0.9fr, auto),
  align: (left, left, left, left, center),
  inset: (x: 5pt, y: 5pt),
  stroke: (x, y) => if y == 0 { (bottom: 1pt + accent) } else { (bottom: 0.4pt + line-color) },
  fill: (x, y) => if y > 0 and calc.even(y) { rgb("#f9fafb") },
  table.header(..([Test], [Method], [Specification], [Result], [Status]).map(h => text(weight: "bold", h))),
  ..data
    .tests
    .map(t => (t.name, text(fill: muted, t.method), t.specification, strong(t.result), badge(t.conforms)))
    .flatten(),
)

#section[Dissolution profile]
#grid(
  columns: (auto, 1fr),
  column-gutter: 14pt,
  align: horizon,
  dissolution-chart(data.dissolution.points, data.dissolution.limit),
  [
    #text(fill: muted)[Medium] \
    #data.dissolution.medium
    #v(4pt)
    #text(fill: muted)[Result at #data.dissolution.limit.minutes min] \
    #let at-limit = data.dissolution.points.find(p => p.minutes == data.dissolution.limit.minutes)
    #strong[#at-limit.percent % dissolved] (limit #data.dissolution.limit.percent %)
  ],
)

#section[Conclusion]
#block(
  width: 100%,
  inset: 8pt,
  radius: 3pt,
  fill: if all-pass { rgb("#f0fdf4") } else { rgb("#fef2f2") },
  stroke: 0.6pt + if all-pass { pass } else { fail },
  [#badge(all-pass) #h(6pt) #data.conclusion],
)

#section[Approvals]
#grid(
  columns: (1fr,) * data.approvals.len(),
  column-gutter: 14pt,
  ..data.approvals.map(a => [
    #v(18pt)
    #line(length: 100%, stroke: 0.5pt + muted)
    #strong(a.name) \
    #text(fill: muted)[#a.role · #a.date]
  ]),
)
