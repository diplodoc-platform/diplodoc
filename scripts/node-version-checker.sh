#!/bin/bash

# Проверяем наличие node_modules
if [ ! -d "node_modules" ]; then
    echo "❌ Директория node_modules не найдена"
    exit 1
fi

# Проверяем наличие jq
if ! command -v jq &> /dev/null; then
    echo "❌ Требуется jq. Установите: brew install jq"
    exit 1
fi

echo "🔍 Анализ зависимостей..."
temp_file=$(mktemp)

# Ищем все package.json в node_modules и извлекаем данные
find node_modules -name package.json | while read -r file; do
    # Пропускаем корневой package.json и битые симлинки
    [ -f "$file" ] || continue
    
    # Извлекаем имя пакета и требования к Node.js
    name=$(jq -r '.name // "БЕЗ ИМЕНИ"' "$file")
    node_ver=$(jq -r '.engines.node // empty' "$file")
    
    if [ -n "$node_ver" ]; then
        echo "$node_ver|$name" >> "$temp_file"
    fi
done

# Группируем и выводим результаты
echo -e "\n📋 Результаты:"
if [ ! -s "$temp_file" ]; then
    echo "ℹ️ Требования к версии Node.js не найдены"
else
    sort "$temp_file" | awk -F'|' '{
        if ($1 != prev) {
            if (prev != "") print ""
            printf "➡️ Требуемая версия Node: %s\n   Пакеты:\n", $1
            prev = $1
        }
        printf "     - %s\n", $2
    }'
fi

rm -f "$temp_file"
