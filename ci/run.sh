#!/usr/bin/env bash
# Запускает команду и при ошибке публикует хвост вывода как аннотацию GitHub Actions,
# чтобы причину сбоя было видно через API проверок без скачивания логов.
# Использование: ci/run.sh <заголовок> <команда...>
title="$1"; shift
out="$("$@" 2>&1)"; code=$?
printf '%s\n' "$out"
if [ "$code" -ne 0 ]; then
  tail_text="$(printf '%s' "$out" | tail -n 80 | tr -d '\r' | sed 's/%/%25/g' | awk '{printf "%s%%0A", $0}')"
  echo "::error title=${title} (код ${code})::${tail_text:0:9000}"
fi
exit "$code"
