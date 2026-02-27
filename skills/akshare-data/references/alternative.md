# 另类数据接口速查

---

## 财经新闻与舆情

```python
# 财经早餐-东财
ak.stock_info_global_em()

# 全球财经快讯-东财
ak.stock_info_global_futu()

# 全球财经快讯-新浪财经
ak.stock_info_global_sina()

# 财联社电报
ak.stock_info_global_cls()

# 个股新闻
ak.stock_news_em(symbol="000001")
```

## 搜索指数与热度

```python
# 百度股市通热搜股票
ak.stock_hot_search_baidu(symbol="A股", date="20240101", time="全天")

# 雪球热帖
ak.stock_hot_xq()

# 股票热度排名-东财
ak.stock_hot_rank_em()

# 股票热度排名-雪球
ak.stock_hot_rank_xq()
```

## 经济日历

```python
# 宏观经济日历
ak.news_economic_baidu(date="20240101")

# 交易日历
ak.tool_trade_date_hist_sina()
```

## 空气与环境

```python
# 空气质量
ak.air_quality_hist(city="北京", period="monthly", start_date="20240101", end_date="20241231")
# city: 城市名称
# period: "daily"/"monthly"
```

## 电影票房

```python
# 实时票房
ak.movie_boxoffice_realtime()

# 每日票房
ak.movie_boxoffice_daily(date="20240101")

# 年度票房
ak.movie_boxoffice_yearly(date="2024")

# 影院日票房排行
ak.movie_boxoffice_cinema_daily(date="20240101")
```

## 能源数据

```python
# 全国油价
ak.energy_oil_hist()

# 国际油价 WTI
ak.futures_foreign_hist(symbol="WTI原油")

# 国际油价 Brent
ak.futures_foreign_hist(symbol="布伦特原油")
```

## 贵金属

```python
# 上海黄金交易所实时行情
ak.spot_golden_benchmark_sge()

# 国际金价
ak.futures_foreign_hist(symbol="伦敦金")

# 国际银价
ak.futures_foreign_hist(symbol="伦敦银")
```
