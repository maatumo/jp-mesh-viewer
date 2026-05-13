# geo-utility

標準地域メッシュコード (Japanese Standard Grid Square Code) を入力すると、対応する矩形を地図上に表示するブラウザツール。

## 使い方

`index.html` をブラウザで開くだけ。ビルド不要。

```
python3 -m http.server 8000
# http://localhost:8000/
```

URL クエリで初期表示もできる:

```
index.html?code=53393599
```

## 対応メッシュ

| 桁数 | 区分 | サイズ |
|------|------|-------|
| 4 | 1次メッシュ | 約 80km |
| 6 | 2次メッシュ | 約 10km |
| 8 | 3次メッシュ | 約 1km |
| 9 | 1/2地域メッシュ | 約 500m |
| 10 | 1/4地域メッシュ | 約 250m |
| 11 | 1/8地域メッシュ | 約 125m |

9/10/11桁の末尾は象限 (1:SW, 2:SE, 3:NW, 4:NE)。

## 構成

- `index.html` / `style.css` / `script.js` のみ
- 地図: [Leaflet](https://leafletjs.com/) + OpenStreetMap (CDN)
