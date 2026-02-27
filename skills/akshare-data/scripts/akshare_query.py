#!/usr/bin/env python3
"""
AKShare 通用数据查询脚本
用法: python3 akshare_query.py <函数名> [参数1=值1] [参数2=值2] ... [--save output.csv] [--head N] [--tail N]

示例:
  python3 akshare_query.py stock_zh_a_hist symbol=000001 period=daily start_date=20240101 end_date=20241231 adjust=qfq
  python3 akshare_query.py stock_zh_a_spot_em --head 20
  python3 akshare_query.py macro_china_cpi --save cpi_data.csv
  python3 akshare_query.py fund_etf_spot_em --head 10
"""
import sys
import subprocess
import importlib


def ensure_akshare():
    """确保 akshare 已安装，未安装则自动安装"""
    try:
        importlib.import_module("akshare")
    except ImportError:
        print("正在安装 akshare (使用清华镜像源)...", file=sys.stderr)
        subprocess.check_call([sys.executable, "-m", "pip", "install", "akshare", "-i", "https://pypi.tuna.tsinghua.edu.cn/simple", "-q"])


def parse_value(val: str):
    """自动解析参数值类型"""
    if val.lower() == "true":
        return True
    if val.lower() == "false":
        return False
    try:
        return int(val)
    except ValueError:
        pass
    try:
        return float(val)
    except ValueError:
        pass
    return val


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
        print(__doc__)
        sys.exit(0)

    func_name = sys.argv[1]
    kwargs = {}
    save_path = None
    head_n = None
    tail_n = None

    i = 2
    while i < len(sys.argv):
        arg = sys.argv[i]
        if arg == "--save" and i + 1 < len(sys.argv):
            save_path = sys.argv[i + 1]
            i += 2
            continue
        if arg == "--head" and i + 1 < len(sys.argv):
            head_n = int(sys.argv[i + 1])
            i += 2
            continue
        if arg == "--tail" and i + 1 < len(sys.argv):
            tail_n = int(sys.argv[i + 1])
            i += 2
            continue
        if "=" in arg:
            key, val = arg.split("=", 1)
            kwargs[key] = parse_value(val)
        i += 1

    ensure_akshare()
    import akshare as ak
    import pandas as pd

    pd.set_option("display.max_columns", None)
    pd.set_option("display.width", 200)
    pd.set_option("display.max_colwidth", 30)

    func = getattr(ak, func_name, None)
    if func is None:
        print(f"错误: akshare 中未找到函数 '{func_name}'", file=sys.stderr)
        print(f"提示: 请检查函数名是否正确，可参考 https://akshare.akfamily.xyz/data/index.html", file=sys.stderr)
        sys.exit(1)

    try:
        print(f"调用: ak.{func_name}({', '.join(f'{k}={v!r}' for k, v in kwargs.items())})", file=sys.stderr)
        result = func(**kwargs)
    except TypeError as e:
        print(f"参数错误: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"查询出错: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(1)

    if isinstance(result, pd.DataFrame):
        if head_n:
            result = result.head(head_n)
        elif tail_n:
            result = result.tail(tail_n)
        if save_path:
            result.to_csv(save_path, index=False, encoding="utf-8-sig")
            print(f"已保存 {len(result)} 行数据到 {save_path}", file=sys.stderr)
        print(result.to_string(index=False))
        print(f"\n共 {len(result)} 行 x {len(result.columns)} 列", file=sys.stderr)
    elif isinstance(result, pd.Series):
        print(result.to_string())
    else:
        print(result)


if __name__ == "__main__":
    main()
