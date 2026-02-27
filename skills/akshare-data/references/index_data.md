# 指数数据接口速查

---

```python
# 中国股票指数实时行情
ak.stock_zh_index_spot_em()
# 返回: 所有A股指数的实时行情（上证指数、深证成指、创业板指 等）

# 中国股票指数历史行情
ak.stock_zh_index_daily_em(symbol="sh000001", start_date="20240101", end_date="20241231")
# symbol: sh000001(上证指数), sz399001(深证成指), sz399006(创业板指), sh000300(沪深300), sh000905(中证500), sh000852(中证1000)

# 中国股票指数成份股
ak.index_stock_cons(symbol="000300")
# symbol: 指数代码（不带前缀）

# 中国股票指数成份股权重
ak.index_stock_cons_weight_csindex(symbol="000300", start_date="20240101")

# 中证指数列表
ak.index_stock_info()

# 指数估值（市盈率/市净率）
ak.stock_a_pe_and_pb(symbol="000300")
# 返回: 指数的历史 PE 和 PB

# 全球股票指数实时行情
ak.stock_zh_index_spot_em(symbol="全球指数")

# 美股指数历史行情
ak.index_us_stock_sina(symbol=".DJI")
# symbol: .DJI(道琼斯), .IXIC(纳斯达克), .INX(标普500)

# 恒生指数历史行情
ak.stock_hk_index_daily_em(symbol="HSI")
# symbol: HSI(恒生指数), HSCCI(红筹指数), HSCEI(国企指数), HSTECH(恒生科技)

# 中证行业指数
ak.sw_index_spot()
# 申万行业指数实时行情

# 申万行业指数历史行情
ak.sw_index_daily(symbol="801010", start_date="20240101", end_date="20241231")
# symbol: 申万行业指数代码

# 板块指数（东财行业）
ak.stock_board_industry_hist_em(symbol="小金属", period="daily", start_date="20240101", end_date="20241231", adjust="qfq")

# 板块指数（东财概念）
ak.stock_board_concept_hist_em(symbol="人工智能", period="daily", start_date="20240101", end_date="20241231", adjust="qfq")
```
