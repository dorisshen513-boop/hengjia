# 衡價

免登入的公開估價網頁。輸入美股或台股代號，用 DCF、剩餘收益 RIM、股利折現與相對倍數估算內在價值，並畫魚帶。

**任何人打開即可用：** [https://dorisshen513-boop.github.io/hengjia/](https://dorisshen513-boop.github.io/hengjia/)

直接帶入一檔：

- [AAPL](https://dorisshen513-boop.github.io/hengjia/?q=AAPL)
- [TSLA](https://dorisshen513-boop.github.io/hengjia/?q=TSLA)
- [2330](https://dorisshen513-boop.github.io/hengjia/?q=2330)

倉庫公開、MIT 授權。不需 GitHub 帳號，也不需安裝。歷史紀錄只存在各人瀏覽器裡。

## 使用

1. 輸入代號（美股 `AAPL`、台股四碼會自動加 `.TW`）
2. 等合理價、魚帶與三年營收情境算出來
3. 「複製公開連結」可把同一檔傳給別人
4. 假設可手動改；不是投資建議

GitHub Pages 是純靜態站，行情走公開資料（瀏覽器端、經 CORS 代理）。沒有伺服器，也不會把金鑰放到前端。

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
