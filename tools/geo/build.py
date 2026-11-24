"""GGH 3.0.0 — build the boundary files the market uses for all 77 provinces.

Source: the user's QA-checked dataset "1. ขอบเขตพื้นที่รายจังหวัด" (Thailand Agri-Risk Map Burning), one folder per province
with province.geojson / districts.geojson / subdistricts.geojson (EPSG:4326). villages.geojson is not used.

    python3 tools/geo/build.py <source folder> frontend/geo

Writes
    provinces.json      77 provinces: code, name, nameEn, bbox, center, simplified outline (index + "which province is this pin")
    p/<code>.json       one province: districts and subdistricts with codes, names and simplified outlines

What it fixes in the source (logged per province):
    - islands stored as separate features → one MultiPolygon per code
    - mojibake names (UTF-8 read as TIS-620) and a few typos → readable Thai
    - empty / duplicate district names → name voted from the subdistricts' own district names; duplicates merged
    - subdistricts whose district code is not in the district layer → district chosen by location
Outlines are simplified (~130 m districts, ~90 m subdistricts, ~450 m province index) and rounded to 4 decimals (~11 m):
good for the map and for telling which district a pin is in, not for surveying.
"""
import json, os, sys, collections, re, datetime
from shapely.geometry import shape, mapping, MultiPolygon, Polygon
from shapely.ops import unary_union

SRC = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser('~/geo/out')
os.makedirs(os.path.join(OUT, 'p'), exist_ok=True)
THAI = r'[฀-๿ \-.()]+'


def rnd(g, nd=4):
    def r(c): return [round(c[0], nd), round(c[1], nd)]
    m = mapping(g)
    if m['type'] == 'Polygon':
        m['coordinates'] = [[r(c) for c in ring] for ring in m['coordinates']]
    elif m['type'] == 'MultiPolygon':
        m['coordinates'] = [[[r(c) for c in ring] for ring in poly] for poly in m['coordinates']]
    return {'type': m['type'], 'coordinates': m['coordinates']}


def clean(g, tol, minarea):
    g = g.buffer(0).simplify(tol, preserve_topology=True)
    parts = list(g.geoms) if hasattr(g, 'geoms') else [g]
    polys = [p for p in parts if isinstance(p, Polygon) and p.area >= minarea]
    if not polys:
        polys = [max(parts, key=lambda p: p.area)]
    return polys[0] if len(polys) == 1 else MultiPolygon(polys)


def en(p, keys):
    for k in keys:
        v = p.get(k) or (p.get('sourceProperties') or {}).get(k)
        if v:
            return str(v).strip().title()
    return ''


CP = {'€': 0x80, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97}
FIX = {'หาดให่ญ': 'หาดใหญ่'}


def fixname(n):
    n = (n or '').strip()
    if n and re.search(r'[\u0080-฀຀-￿]', n) and not re.fullmatch(THAI, n):
        try:   # UTF-8 bytes that were decoded as TIS-620 (cp874): turn the characters back into bytes
            b = bytes((ord(ch) - 0x0e00 + 0xa0) if 0x0e01 <= ord(ch) <= 0x0e5b else CP.get(ch, ord(ch)) for ch in n)
            m = b.decode('utf-8')
            if re.fullmatch(THAI, m):
                n = m
        except Exception:
            pass
    return FIX.get(n, n)


def bbox(g):
    b = g.bounds
    return [round(b[0], 4), round(b[1], 4), round(b[2], 4), round(b[3], 4)]


def ctr(g):
    c = g.representative_point()
    return [round(c.y, 5), round(c.x, 5)]


index, report = [], []
for folder in sorted(os.listdir(SRC)):
    pf = os.path.join(SRC, folder, 'province.geojson')
    if not os.path.isfile(pf):
        continue
    P = json.load(open(pf, encoding='utf-8'))
    pp = P['features'][0]['properties']
    code = str(pp['provinceCode'])
    pname = fixname(pp.get('nameTH') or folder)
    pgeom = unary_union([shape(f['geometry']) for f in P['features']]).buffer(0)

    D = json.load(open(os.path.join(SRC, folder, 'districts.geojson'), encoding='utf-8'))
    groups = collections.OrderedDict()
    for f in D['features']:
        p = f['properties']
        dc = str(p['districtCode'])
        g = groups.setdefault(dc, {'code': dc, 'name': p.get('nameTH') or p.get('__district'),
                                   'nameEn': en(p, ['AMP_NAME_E', 'A_NAME_E', 'AMP_E', 'NAME_E']), 'areaRai': 0, 'parts': []})
        g['parts'].append(shape(f['geometry']))
        g['areaRai'] += float(p.get('AREA_RAI') or 0)
    for g in groups.values():
        g['geom'] = unary_union(g['parts']).buffer(0)

    S = json.load(open(os.path.join(SRC, folder, 'subdistricts.geojson'), encoding='utf-8'))
    sg = collections.OrderedDict()
    for f in S['features']:
        p = f['properties']
        sc = str(p['subdistrictCode'])
        g = sg.setdefault(sc, {'code': sc, 'name': fixname(p.get('nameTH') or p.get('__subdistrict')),
                               'districtCode': str(p.get('districtCode') or p.get('parentCode')),
                               'dname': fixname(p.get('__district') or p.get('A_NAME_T')), 'parts': []})
        g['parts'].append(shape(f['geometry']))
    subs, votes, orphans = [], collections.defaultdict(collections.Counter), 0
    for g in sg.values():
        geom = unary_union(g['parts']).buffer(0)
        dc = g['districtCode']
        if dc not in groups:
            pt = geom.representative_point()
            orphans += 1
            hit = [k for k, v in groups.items() if v['geom'].contains(pt)]
            dc = hit[0] if hit else min(groups, key=lambda k: groups[k]['geom'].distance(pt))
        if g['dname']:
            votes[dc][g['dname']] += geom.area
        subs.append({'code': g['code'], 'name': g['name'], 'districtCode': dc, 'geometry': rnd(clean(geom, 0.0008, 2e-7))})

    districts = []
    for g in groups.values():
        own = fixname(g['name'])
        vote = votes[g['code']].most_common(1)[0][0] if votes[g['code']] else ''
        name = own if own and re.fullmatch(THAI, own) else (vote or own)
        districts.append({'code': g['code'], 'name': name, 'nameEn': g['nameEn'], 'areaRai': round(g['areaRai']),
                          'center': ctr(g['geom']), 'geometry': rnd(clean(g['geom'], 0.0012, 1e-6))})
    names = collections.Counter(d['name'] for d in districts)
    for d in districts:
        v = votes[d['code']].most_common(1)[0][0] if votes[d['code']] else ''
        if names[d['name']] > 1 and v and v != d['name']:
            d['name'] = v
    subcount = collections.Counter(x['districtCode'] for x in subs)
    byname = collections.defaultdict(list)
    for d in districts:
        byname[d['name']].append(d)
    merged = []
    for nm, ds in byname.items():
        if len(ds) == 1:
            merged.append(ds[0])
            continue
        keep = max(ds, key=lambda d: subcount[d['code']])
        geom = unary_union([groups[d['code']]['geom'] for d in ds]).buffer(0)
        keep['geometry'] = rnd(clean(geom, 0.0012, 1e-6))
        keep['areaRai'] = sum(d['areaRai'] for d in ds)
        keep['center'] = ctr(geom)
        for d in ds:
            if d is not keep:
                for x in subs:
                    if x['districtCode'] == d['code']:
                        x['districtCode'] = keep['code']
        merged.append(keep)
    districts = sorted(merged, key=lambda d: d['code'])
    subs.sort(key=lambda s: s['code'])

    nameEn = en(pp, ['PROV_NAME', 'P_NAME_E', 'PROV_NAME_E', 'NAME_E'])
    out = {'code': code, 'name': pname, 'nameEn': nameEn, 'bbox': bbox(pgeom), 'center': ctr(pgeom), 'districts': districts, 'subdistricts': subs}
    s = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
    open(os.path.join(OUT, 'p', code + '.json'), 'w', encoding='utf-8').write(s)
    index.append({'code': code, 'name': pname, 'nameEn': nameEn, 'bbox': bbox(pgeom), 'center': ctr(pgeom),
                  'districts': len(districts), 'subdistricts': len(subs), 'geometry': rnd(clean(pgeom, 0.004, 1e-5))})
    report.append((code, pname, len(districts), len(subs), len(s), 'orphans', orphans))

index.sort(key=lambda p: p['name'])
meta = {'version': 1, 'generatedAt': datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'source': 'ขอบเขตการปกครอง 77 จังหวัด (ชุดข้อมูล Thailand Agri-Risk Map Burning, ตรวจ QA 77/77)', 'provinces': index}
open(os.path.join(OUT, 'provinces.json'), 'w', encoding='utf-8').write(json.dumps(meta, ensure_ascii=False, separators=(',', ':')))
for r in report:
    print(*r)
print('provinces', len(index), 'districts', sum(p['districts'] for p in index), 'subdistricts', sum(p['subdistricts'] for p in index))
