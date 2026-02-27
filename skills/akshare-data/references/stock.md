# 股票数据接口速查

## 目录
- [A股实时行情](#a股实时行情)
- [A股历史行情](#a股历史行情)
- [港股行情](#港股行情)
- [美股行情](#美股行情)
- [财务报表](#财务报表)
- [资金流向](#资金流向)
- [板块行情](#板块行情)
- [沪深港通](#沪深港通)
- [龙虎榜](#龙虎榜)
- [融资融券](#融资融券)
- [分红配送](#分红配送)
- [新股数据](#新股数据)
- [股票列表](#股票列表)
- [其他](#其他)

---

## A股实时行情

```python
# 沪深京 A 股实时行情（全市场）
ak.stock_zh_a_spot_em()
# 返回: 序号, 代码, 名称, 最新价, 涨跌幅, 涨跌额, 成交量, 成交额, 振幅, 最高, 最低, 今开, 昨收, 量比, 换手率, 市盈率, 市净率, 总市值, 流通市值, 涨速, 5分钟涨跌, 60日涨跌幅, 年初至今涨跌幅

# 仅沪 A 股
ak.stock_sh_a_spot_em()

# 仅深 A 股
ak.stock_sz_a_spot_em()

# 仅北交所
ak.stock_bj_a_spot_em()

# 新浪实时行情（返回字段略有不同）
ak.stock_zh_a_spot()
```

## A股历史行情

```python
# 东财-沪深京 A 股历史行情（推荐）
ak.stock_zh_a_hist(symbol="000001", period="daily", start_date="20240101", end_date="20241231", adjust="qfq")
# symbol: 股票代码（6位）
# period: daily/weekly/monthly
# adjust: ""(不复权) / "qfq"(前复权) / "hfq"(后复权)
# 返回: 日期, 股票代码, 开盘, 收盘, 最高, 最低, 成交量, 成交额, 振幅, 涨跌幅, 涨跌额, 换手率

# 新浪历史行情
ak.stock_zh_a_daily(symbol="sz000001", start_date="20240101", end_date="20241231", adjust="qfq")
# symbol 格式: sz000001 / sh600000

# 分时数据（当日）
ak.stock_zh_a_hist_min_em(symbol="000001", period="1", start_date="2024-01-01 09:30:00", end_date="2024-01-01 15:00:00", adjust="qfq")
# period: "1"(1分钟) / "5" / "15" / "30" / "60"

# 盘前数据
ak.stock_zh_a_hist_pre_min_em(symbol="000001")
```

## 港股行情

```python
# 港股实时行情
ak.stock_hk_spot_em()

# 港股主板实时行情
ak.stock_hk_main_board_spot_em()

# 港股历史行情
ak.stock_hk_hist(symbol="00700", period="daily", start_date="20240101", end_date="20241231", adjust="qfq")

# 港股分时数据
ak.stock_hk_hist_min_em(symbol="00700", period="1")
```

## 美股行情

```python
# 美股实时行情
ak.stock_us_spot_em()

# 美股历史行情-东财
ak.stock_us_hist(symbol="105.AAPL", period="daily", start_date="20240101", end_date="20241231", adjust="qfq")
# symbol: 东财代码格式，如 105.AAPL（纳斯达克）, 106.BA（纽交所）

# 美股历史行情-新浪
ak.stock_us_daily(symbol="AAPL", adjust="qfq")

# 知名美股列表
ak.stock_us_famous_spot_em(symbol="科技类")
# symbol: "科技类"/"金融类"/"医药食品类"/"媒体类"/"中概股"等
```

## 财务报表

```python
# 业绩报表（东财）
ak.stock_yjbb_em(date="20240331")
# date: 报告期 YYYYMMDD，如 20240331(一季报) / 20240630(半年报) / 20240930(三季报) / 20241231(年报)

# 业绩快报
ak.stock_yjkb_em(date="20240331")

# 业绩预告
ak.stock_yjtj_em(date="20240331")

# 资产负债表（东财）
ak.stock_balance_sheet_by_report_em(symbol="000001")

# 利润表（东财）
ak.stock_profit_sheet_by_report_em(symbol="000001")

# 现金流量表（东财）
ak.stock_cash_flow_sheet_by_report_em(symbol="000001")

# 主要财务指标
ak.stock_financial_abstract_em(symbol="000001")

# 个股估值
ak.stock_a_indicator_lg(symbol="000001")
# 返回: pe, pe_ttm, pb, ps, ps_ttm, dv_ratio, dv_ttm, total_mv 等
```

## 资金流向

```python
# 个股资金流（东财）
ak.stock_individual_fund_flow(stock="000001", market="sz")
# market: "sz"/"sh"

# 个股资金流排名
ak.stock_individual_fund_flow_rank(indicator="今日")
# indicator: "今日"/"3日"/"5日"/"10日"

# 大盘资金流
ak.stock_market_fund_flow()

# 板块资金流排名
ak.stock_sector_fund_flow_rank(indicator="今日", sector_type="行业资金流")
# sector_type: "行业资金流"/"概念资金流"/"地域资金流"

# 主力净流入排名（东财）
ak.stock_main_fund_flow(symbol="全部股票")
# symbol: "全部股票"/"沪深A股"/"沪市A股"/"深市A股" 等
```

## 板块行情

```python
# 行业板块列表（东财）
ak.stock_board_industry_name_em()

# 行业板块实时行情
ak.stock_board_industry_spot_em()

# 行业板块成份股
ak.stock_board_industry_cons_em(symbol="小金属")

# 行业板块历史行情
ak.stock_board_industry_hist_em(symbol="小金属", period="daily", start_date="20240101", end_date="20241231", adjust="qfq")

# 概念板块列表（东财）
ak.stock_board_concept_name_em()

# 概念板块实时行情
ak.stock_board_concept_spot_em()

# 概念板块成份股
ak.stock_board_concept_cons_em(symbol="人工智能")

# 概念板块历史行情
ak.stock_board_concept_hist_em(symbol="人工智能", period="daily", start_date="20240101", end_date="20241231", adjust="qfq")
```

## 沪深港通

```python
# 沪深港通历史数据
ak.stock_hsgt_hist_em(symbol="沪股通")
# symbol: "沪股通"/"深股通"/"北向资金"

# 沪深港通持股-个股
ak.stock_hsgt_individual_em(symbol="000001")

# 沪深港通持股-个股详情
ak.stock_hsgt_individual_detail_em(symbol="000001", start_date="20240101", end_date="20241231")

# 板块排行
ak.stock_hsgt_board_rank_em(symbol="北向资金增持行业板块排行", indicator="今日")

# 个股排行
ak.stock_hsgt_stock_rank_em(symbol="北向资金增持排行", indicator="今日")
```

## 龙虎榜

```python
# 龙虎榜详情
ak.stock_lhb_detail_em(start_date="20240101", end_date="20240131")

# 龙虎榜-个股上榜统计
ak.stock_lhb_stock_statistic_em(symbol="近一月")
# symbol: "近一月"/"近三月"/"近六月"/"近一年"

# 龙虎榜-机构席位追踪
ak.stock_lhb_jgmmtj_em(start_date="20240101", end_date="20240131")

# 个股龙虎榜详情
ak.stock_lhb_stock_detail_em(symbol="000001", date="20240101", flag="买入")
# flag: "买入"/"卖出"
```

## 融资融券

```python
# 融资融券-沪市汇总
ak.stock_margin_sse(start_date="20240101", end_date="20240131")

# 融资融券-深市汇总
ak.stock_margin_szse(start_date="20240101", end_date="20240131")

# 融资融券-标的证券
ak.stock_margin_underlying_info_szse(date="2024-01-01")
```

## 分红配送

```python
# 分红配送（东财）
ak.stock_fhps_em(date="20231231")
# date: 报告期

# 分红配送详情
ak.stock_fhps_detail_em(symbol="000001")

# 历史分红
ak.stock_history_dividend(indicator="分红")
# indicator: "分红"/"配股"
```

## 新股数据

```python
# 新股申购与中签
ak.stock_xgsglb_em(symbol="全部股票")

# 打新收益率
ak.stock_xgsg_ipo_em(symbol="京市")
# symbol: "沪市"/"深市"/"京市"

# IPO 审核信息
ak.stock_register_ipo(symbol="科创板")
# symbol: "科创板"/"创业板"/"北交所"
```

## 股票列表

```python
# A股股票列表
ak.stock_info_a_code_name()
# 返回: code, name

# 沪市列表
ak.stock_info_sh_name_code(symbol="主板A股")
# symbol: "主板A股"/"科创板"

# 深市列表
ak.stock_info_sz_name_code(indicator="A股列表")
# indicator: "A股列表"/"B股列表"

# A+H 股票字典
ak.stock_zh_ah_name()
```

## 其他

```python
# 千股千评
ak.stock_comment_em()

# 停复牌信息
ak.stock_tfp_em(date="20240101")

# 涨停股池
ak.stock_zt_pool_em(date="20240101")

# 跌停股池
ak.stock_zt_pool_dtgc_em(date="20240101")

# 盘口异动
ak.stock_changes_em(symbol="大笔买入")
# symbol: "火箭发射"/"快速反弹"/"大笔买入"/"封涨停板"/"打开跌停板"/"有大买盘"/"竞价上涨"/"高开5日线"/"向上缺口"/"60日新高"/"60日大幅上涨"/"加速下跌"/"高台跳水"/"大笔卖出"/"封跌停板"/"打开涨停板"/"有大卖盘"/"竞价下跌"/"低开5日线"/"向下缺口"/"60日新低"/"60日大幅下跌"

# 个股新闻
ak.stock_news_em(symbol="000001")

# 涨跌投票
ak.stock_a_vote_em()

# 大宗交易-市场统计
ak.stock_dzjy_sctj()

# 大宗交易-每日明细
ak.stock_dzjy_mrmx(symbol="000001", start_date="20240101", end_date="20240131")

# 股票热度-东财
ak.stock_hot_rank_em()

# 个股研报
ak.stock_research_report_em(symbol="000001")

# ESG 评级
ak.stock_esg_hz_sina()
```
