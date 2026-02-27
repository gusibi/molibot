# 期权数据接口速查

---

```python
# 金融期权-上交所 50ETF 期权（实时）
ak.option_sse_spot_price(symbol="510050")
# symbol: 标的代码

# 金融期权-上交所期权行情列表
ak.option_sse_list(symbol="510050", exchange="null")

# 金融期权-上交所期权到期日
ak.option_sse_expire_day(trade_date="202401", symbol="510050", exchange="null")

# 金融期权-希腊字母
ak.option_sse_greeks(symbol="510050")

# 商品期权-大商所
ak.option_dce_daily(symbol="铁矿石期权", trade_date="20240101")

# 商品期权-郑商所
ak.option_czce_daily(symbol="白糖期权", trade_date="20240101")

# 商品期权-上期所
ak.option_shfe_daily(symbol="铜期权", trade_date="20240101")

# 期权隐含波动率-中金所
ak.option_cffex_hs300_spot_em()
# 沪深300期权实时行情

# 50ETF 期权日线-东财
ak.option_daily_hist_em(symbol="510050")

# 期权合约信息
ak.option_sse_codes_sina()

# 金融期权-上交所期权成交量/持仓量
ak.option_sse_minute(symbol="510050")

# 可转债期权价值
ak.bond_cb_jsl()
# 可转债也可视为一种期权
```
