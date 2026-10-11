#!/bin/bash
# store-key-in-vault.sh · 把本机 omp 在用的 DeepSeek Key 存进 KeePassXC 保险库
#
# 链路（单向，保险库是唯一的长期归档）：
#   ~/.omp/agent/agent.db 的 deepseek 凭据 ─┐
#                                           ├─→ 保险库 agent-mind/DEEPSEEK_API_KEY
#   或环境变量 $DEEPSEEK_API_KEY           ─┘
#
# 主密码只在本脚本内读一次，不落盘、不进环境变量、不进命令行参数（ps 看不到 Key）。
# 写入后会回读比对，不一致就报错，不会让你以为存进去了。
#
# 用法：
#   bash tools/store-key-in-vault.sh
#   DEEPSEEK_API_KEY=sk-xxx bash tools/store-key-in-vault.sh   # 直接给值，不读 omp
#   ENTRY=MY_KEY  bash tools/store-key-in-vault.sh             # 换条目名
#   VAULT=/path/to/db.kdbx bash tools/store-key-in-vault.sh    # 换保险库

set -euo pipefail

CLI="${KEEPASSXC_CLI:-/Applications/KeePassXC.app/Contents/MacOS/keepassxc-cli}"
[ -x "$CLI" ] || CLI="$(command -v keepassxc-cli || true)"

# 同步盘在本机叫「共享」，旧名「百度云同步」是兼容软链，两条路径都通
VAULT="${VAULT:-$HOME/Documents/百度云同步/agent-mind-secrets.kdbx}"
GROUP="${GROUP:-agent-mind}"
ENTRY="${ENTRY:-DEEPSEEK_API_KEY}"
OMP_DB="${OMP_DB:-$HOME/.omp/agent/agent.db}"
SYNC_SH="$HOME/Documents/百度云同步/agent-mind/tools/sync-secrets.sh"

die() { echo "❌ $*" >&2; exit 1; }

# ---------- 1. 取 Key ----------
KEY="${DEEPSEEK_API_KEY:-}"
SOURCE="环境变量 DEEPSEEK_API_KEY"
if [ -z "$KEY" ]; then
  [ -f "$OMP_DB" ] || die "既没有 \$DEEPSEEK_API_KEY，也找不到 omp 凭据库：$OMP_DB"
  command -v sqlite3 >/dev/null 2>&1 || die "需要 sqlite3 才能读 omp 凭据库"
  KEY="$(sqlite3 "$OMP_DB" "select json_extract(data,'\$.key') from auth_credentials where provider='deepseek' limit 1;" 2>/dev/null || true)"
  SOURCE="omp 凭据库 $OMP_DB → deepseek"
fi
[ -n "$KEY" ] || die "取不到 Key。检查 omp 是否已登录 deepseek：sqlite3 \"$OMP_DB\" \"select provider from auth_credentials;\""

echo "Key 来源：$SOURCE"
echo "Key 指纹：${KEY:0:6}…（共 ${#KEY} 位）"
echo "保险库  ：$VAULT"
echo "目标条目：$GROUP/$ENTRY"
echo

# ---------- 2. 前置检查 ----------
[ -x "$CLI" ] || die "找不到 keepassxc-cli，可用 KEEPASSXC_CLI=/path/to/keepassxc-cli 指定"
[ -f "$VAULT" ] || die "保险库不存在：$VAULT"

# ---------- 3. 主密码（仅存于变量，用完即弃） ----------
if [ -t 0 ]; then
  read -r -s -p "保险库主密码: " DBPW; echo ""
else
  IFS= read -r DBPW
fi
[ -n "$DBPW" ] || die "未输入主密码"

echo "$DBPW" | "$CLI" ls -q "$VAULT" >/dev/null 2>&1 || die "主密码错误，或保险库损坏"

if ! echo "$DBPW" | "$CLI" ls -q "$VAULT" "$GROUP" >/dev/null 2>&1; then
  echo "❌ 保险库里没有分组 ${GROUP}/。该库顶层内容如下：" >&2
  echo "$DBPW" | "$CLI" ls -q "$VAULT" 2>/dev/null | grep -v '^\[.*\]$' | sed 's/^/     /' >&2 || true
  unset DBPW
  echo "   处理：在 KeePassXC 里新建分组 ${GROUP}，或 GROUP=别的组名 重跑本脚本。" >&2
  exit 1
fi

# ---------- 4. 写入（存在则更新，不存在则新建） ----------
EXISTS=0
if echo "$DBPW" | "$CLI" show -q "$VAULT" "$GROUP/$ENTRY" >/dev/null 2>&1; then
  EXISTS=1
fi

if [ "$EXISTS" = "1" ]; then
  echo "条目已存在 → 更新密码字段"
  printf '%s\n%s\n%s\n' "$DBPW" "$KEY" "$KEY" | "$CLI" edit -q -p "$VAULT" "$GROUP/$ENTRY"
else
  echo "条目不存在 → 新建"
  printf '%s\n%s\n%s\n' "$DBPW" "$KEY" "$KEY" \
    | "$CLI" add -q -p --notes "来源：${SOURCE}（由 transelle/tools/store-key-in-vault.sh 写入）" \
        "$VAULT" "$GROUP/$ENTRY"
fi

# ---------- 5. 回读比对（不信写入动作，只看结果） ----------
BACK="$(echo "$DBPW" | "$CLI" show -q -s -a Password "$VAULT" "$GROUP/$ENTRY" 2>/dev/null || true)"
unset DBPW

if [ "$BACK" != "$KEY" ]; then
  unset KEY
  cat >&2 <<'ERR'
❌ 回读校验失败：保险库里的值与预期不一致。
   保险库没有被改坏，但这条没写对。请在 KeePassXC 图形界面里手动处理：
     分组 agent-mind/ → 新建条目，标题 DEEPSEEK_API_KEY，密码字段粘贴 Key。
   然后重跑 agent-mind/tools/sync-secrets.sh 验证。
ERR
  exit 1
fi
unset KEY

echo "✅ 已写入并通过回读校验：$GROUP/$ENTRY"

# ---------- 6. 刷新本机 secrets.env ----------
if [ -x "$SYNC_SH" ] || [ -f "$SYNC_SH" ]; then
  echo
  echo "下一步（可选）：刷新本机 secrets.env → bash \"$SYNC_SH\""
fi
