#!/usr/bin/env bash
# Keeps the molibot control daemon (bin/molibot-control.js) alive with a tiny
# nohup-based supervisor loop. The control daemon must outlive the main service,
# so it gets its own supervisor independent of molibot-service.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PATH="$SCRIPT_DIR/$(basename "${BASH_SOURCE[0]}")"
CONTROL_SCRIPT="${MOLIBOT_CONTROL_SCRIPT:-$SCRIPT_DIR/molibot-control.js}"
START_COMMAND="${MOLIBOT_CONTROL_START_COMMAND:-node \"$CONTROL_SCRIPT\"}"
LOG_FILE="${MOLIBOT_CONTROL_LOG_FILE:-$HOME/logs/molibot-control.log}"
PID_FILE="${MOLIBOT_CONTROL_PID_FILE:-$HOME/.molibot/molibot-control.pid}"
CHILD_PID_FILE="${MOLIBOT_CONTROL_CHILD_PID_FILE:-${PID_FILE%.pid}.child.pid}"
STOP_FILE="${MOLIBOT_CONTROL_STOP_FILE:-${PID_FILE%.pid}.stop}"
RESTART_DELAY_SECONDS="${MOLIBOT_CONTROL_RESTART_DELAY_SECONDS:-2}"
LOG_DIR="$(dirname "$LOG_FILE")"
PID_DIR="$(dirname "$PID_FILE")"

is_running() {
  local pid="$1"
  [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null
}

read_pid_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  cat "$file" 2>/dev/null || true
}

supervisor_loop() {
  local child_pid=""
  local stopping=0

  stop_child() {
    stopping=1
    if is_running "$child_pid"; then
      kill "$child_pid" 2>/dev/null || true
      wait "$child_pid" 2>/dev/null || true
    fi
    rm -f "$CHILD_PID_FILE"
  }

  trap stop_child TERM INT
  echo "[molibot-control-service] supervisor started command=$START_COMMAND"

  while true; do
    rm -f "$STOP_FILE"
    (
      exec bash -lc "$START_COMMAND"
    ) &
    child_pid=$!
    echo "$child_pid" > "$CHILD_PID_FILE"
    echo "[molibot-control-service] child started pid=$child_pid"

    set +e
    wait "$child_pid"
    local exit_code=$?
    set -e
    rm -f "$CHILD_PID_FILE"

    if [[ "$stopping" == "1" || -f "$STOP_FILE" ]]; then
      echo "[molibot-control-service] supervisor stopped"
      rm -f "$STOP_FILE"
      return 0
    fi

    echo "[molibot-control-service] child exited code=$exit_code; restarting in ${RESTART_DELAY_SECONDS}s"
    sleep "$RESTART_DELAY_SECONDS"
  done
}

start_service() {
  mkdir -p "$LOG_DIR" "$PID_DIR"

  if [[ -f "$PID_FILE" ]]; then
    local old_pid
    old_pid="$(read_pid_file "$PID_FILE")"
    if is_running "$old_pid"; then
      echo "molibot-control already running"
      echo "supervisor_pid: $old_pid"
      echo "child_pid: $(read_pid_file "$CHILD_PID_FILE")"
      echo "log: $LOG_FILE"
      return 0
    fi
  fi

  if [[ ! -f "$CONTROL_SCRIPT" ]]; then
    echo "control daemon not found: $CONTROL_SCRIPT" >&2
    return 1
  fi

  rm -f "$STOP_FILE"
  nohup env \
    MOLIBOT_CONTROL_SCRIPT="$CONTROL_SCRIPT" \
    MOLIBOT_CONTROL_START_COMMAND="$START_COMMAND" \
    MOLIBOT_CONTROL_LOG_FILE="$LOG_FILE" \
    MOLIBOT_CONTROL_PID_FILE="$PID_FILE" \
    MOLIBOT_CONTROL_CHILD_PID_FILE="$CHILD_PID_FILE" \
    MOLIBOT_CONTROL_STOP_FILE="$STOP_FILE" \
    MOLIBOT_CONTROL_RESTART_DELAY_SECONDS="$RESTART_DELAY_SECONDS" \
    "$SCRIPT_PATH" supervise >>"$LOG_FILE" 2>&1 < /dev/null &
  local pid=$!
  disown || true
  echo "$pid" > "$PID_FILE"

  echo "molibot-control supervisor started in background"
  echo "supervisor_pid: $pid"
  echo "command: $START_COMMAND"
  echo "log: $LOG_FILE"
  echo "pid_file: $PID_FILE"
}

stop_service() {
  if [[ ! -f "$PID_FILE" ]]; then
    echo "molibot-control not running (pid file not found)"
    return 0
  fi

  local pid
  pid="$(read_pid_file "$PID_FILE")"
  if [[ -z "${pid:-}" ]]; then
    rm -f "$PID_FILE" "$CHILD_PID_FILE" "$STOP_FILE"
    echo "molibot-control not running (empty pid file, cleaned)"
    return 0
  fi

  echo "stop" > "$STOP_FILE"

  if ! is_running "$pid"; then
    local child_pid
    child_pid="$(read_pid_file "$CHILD_PID_FILE")"
    if is_running "$child_pid"; then
      kill "$child_pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE" "$CHILD_PID_FILE" "$STOP_FILE"
    echo "molibot-control not running (stale pid file cleaned)"
    return 0
  fi

  kill "$pid"

  for _ in {1..20}; do
    if ! is_running "$pid"; then
      rm -f "$PID_FILE" "$CHILD_PID_FILE" "$STOP_FILE"
      echo "molibot-control stopped"
      return 0
    fi
    sleep 0.2
  done

  echo "molibot-control still running, sending SIGKILL"
  kill -9 "$pid" 2>/dev/null || true
  local child_pid
  child_pid="$(read_pid_file "$CHILD_PID_FILE")"
  if is_running "$child_pid"; then
    kill -9 "$child_pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE" "$CHILD_PID_FILE" "$STOP_FILE"
  echo "molibot-control stopped"
}

status_service() {
  if [[ ! -f "$PID_FILE" ]]; then
    echo "status: stopped"
    echo "pid_file: $PID_FILE (missing)"
    echo "command: $START_COMMAND"
    echo "log: $LOG_FILE"
    return 1
  fi

  local pid
  pid="$(read_pid_file "$PID_FILE")"
  if is_running "${pid:-}"; then
    local child_pid
    child_pid="$(read_pid_file "$CHILD_PID_FILE")"
    echo "status: running"
    echo "supervisor_pid: $pid"
    if is_running "$child_pid"; then
      echo "child_pid: $child_pid"
    else
      echo "child_pid: ${child_pid:-unknown} (starting or restarting)"
    fi
    echo "command: $START_COMMAND"
    echo "log: $LOG_FILE"
    return 0
  fi

  echo "status: stopped"
  echo "pid_file: $PID_FILE (stale)"
  echo "command: $START_COMMAND"
  echo "log: $LOG_FILE"
  return 1
}

usage() {
  cat <<EOF
Usage:
  $(basename "$0") start
  $(basename "$0") stop
  $(basename "$0") status
  $(basename "$0") restart

Environment:
  MOLIBOT_CONTROL_SCRIPT          Path to molibot-control.js (default: alongside this script)
  MOLIBOT_CONTROL_START_COMMAND   Command to run the daemon (default: node molibot-control.js)
  MOLIBOT_CONTROL_LOG_FILE        Log file path
  MOLIBOT_CONTROL_PID_FILE        PID file path
  MOLIBOT_CONTROL_RESTART_DELAY_SECONDS
                                  Delay before restarting a crashed daemon (default: 2)
EOF
}

command="${1:-status}"
case "$command" in
  start) start_service ;;
  stop) stop_service ;;
  status) status_service ;;
  restart) stop_service || true; start_service ;;
  supervise) supervisor_loop ;;
  help|-h|--help) usage ;;
  *)
    echo "unknown command: $command" >&2
    usage
    exit 1
    ;;
esac
