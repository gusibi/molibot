#!/usr/bin/env bash
set -euo pipefail

LOG_FILE="${MOLIBOT_LOG_FILE:-$HOME/logs/molibot.log}"
PID_FILE="${MOLIBOT_PID_FILE:-$HOME/.molibot/molibot.pid}"
LOG_DIR="$(dirname "$LOG_FILE")"
PID_DIR="$(dirname "$PID_FILE")"

start_service() {
  mkdir -p "$LOG_DIR"
  mkdir -p "$PID_DIR"

  if [[ -f "$PID_FILE" ]]; then
    local old_pid
    old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "${old_pid:-}" ]] && kill -0 "$old_pid" 2>/dev/null; then
      echo "molibot already running"
      echo "pid: $old_pid"
      echo "log: $LOG_FILE"
      return 0
    fi
  fi

  nohup molibot >>"$LOG_FILE" 2>&1 < /dev/null &
  local pid=$!
  disown || true
  echo "$pid" > "$PID_FILE"

  echo "molibot started in background"
  echo "pid: $pid"
  echo "log: $LOG_FILE"
  echo "pid_file: $PID_FILE"
}

stop_service() {
  if [[ ! -f "$PID_FILE" ]]; then
    echo "molibot not running (pid file not found)"
    return 0
  fi

  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -z "${pid:-}" ]]; then
    rm -f "$PID_FILE"
    echo "molibot not running (empty pid file, cleaned)"
    return 0
  fi

  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$PID_FILE"
    echo "molibot not running (stale pid file cleaned)"
    return 0
  fi

  kill "$pid"

  for _ in {1..20}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "molibot stopped"
      return 0
    fi
    sleep 0.2
  done

  echo "molibot still running, sending SIGKILL"
  kill -9 "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "molibot stopped"
}

status_service() {
  if [[ ! -f "$PID_FILE" ]]; then
    echo "status: stopped"
    echo "pid_file: $PID_FILE (missing)"
    echo "log: $LOG_FILE"
    return 1
  fi

  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -z "${pid:-}" ]]; then
    echo "status: stopped"
    echo "pid_file: $PID_FILE (empty)"
    echo "log: $LOG_FILE"
    return 1
  fi

  if kill -0 "$pid" 2>/dev/null; then
    echo "status: running"
    echo "pid: $pid"
    echo "pid_file: $PID_FILE"
    echo "log: $LOG_FILE"
    return 0
  fi

  echo "status: stopped"
  echo "pid_file: $PID_FILE (stale)"
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
EOF
}

command="${1:-status}"
case "$command" in
  start)
    start_service
    ;;
  stop)
    stop_service
    ;;
  status)
    status_service
    ;;
  restart)
    stop_service || true
    start_service
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    echo "unknown command: $command" >&2
    usage
    exit 1
    ;;
esac
