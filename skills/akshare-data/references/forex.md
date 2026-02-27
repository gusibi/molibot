# 外汇数据接口速查

---

```python
# 人民币汇率（中国外汇交易中心）
ak.fx_spot_quote()
# 返回: 货币对, 买报价, 卖报价, 中间价, 时间

# 人民币中间价（央行）
ak.fx_pair_quote(symbol="美元/人民币")
# symbol: "美元/人民币"/"欧元/人民币"/"日元/人民币"/"英镑/人民币"等

# 外汇实时行情-新浪
ak.fx_spot_quote_detail(symbol="USDCNY")
# symbol: 货币对代码，如 USDCNY, EURUSD, GBPUSD, USDJPY 等

# 外汇历史行情-新浪
ak.fx_quote_baidu(symbol="美元兑人民币")
# symbol: "美元兑人民币"/"欧元兑人民币"/"英镑兑人民币"/"日元兑人民币" 等

# 主要实时汇率
ak.currency_boc_safe()
# 返回: 中国银行外汇牌价，包含现汇买入价、现钞买入价、现汇卖出价、现钞卖出价

# 货币对历史数据
ak.fx_hist_em(symbol="USDCNY", period="daily", start_date="20240101", end_date="20241231")
# 东财外汇历史行情

# 离岸人民币
ak.fx_spot_quote_detail(symbol="USDCNH")
```
