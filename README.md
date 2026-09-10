# 衡價

用 DCF、剩餘收益 RIM、股利折現與相對倍數估算股票內在價值。輸入代號即可從公開行情帶入財報，再依新聞風險微調假設。

**公開站：** [https://dorisshen513-boop.github.io/hengjia/](https://dorisshen513-boop.github.io/hengjia/)

## 使用

1. 輸入代號（美股 `AAPL`、台股四碼會自動加 `.TW`）
2. 等合理價、魚帶與三年營收情境算出來
3. 假設可手動改；歷史紀錄存在瀏覽器本機

GitHub Pages 是純靜態站，行情走 Yahoo／Nasdaq 公開資料（瀏覽器端、經 CORS 代理）。沒有伺服器，也不會把 Grok API 金鑰放到前端。

## 本機

```bash
npm install
npm run dev
```

靜態站（與 GitHub Pages 相同設定）：

```bash
npm run build:pages
```

產物在 `dist/client`。
