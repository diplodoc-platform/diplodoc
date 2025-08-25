#!/usr/bin/env bash

# Создаём резервную копию .gitmodules
cp .gitmodules .gitmodules.tmp

# Файл со списком репозиториев в формате:
# [+|-] [имя] [URL] [путь]
CONFIG_FILE="submodules.conf"

if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "Error: Configuration file $CONFIG_FILE not found!" >&2
    exit 1
fi

# Функция для проверки существования субмодуля по пути
submodule_exists() {
    local path="$1"
    grep -q "^\[submodule \"$path\"\]" .gitmodules
}

ADDED_SUBMODULES=()
FAILED_SUBMODULES=()
REMOVED_SUBMODULES=()

while IFS= read -r line || [[ -n "$line" ]]; do
    # Пропускаем комментарии и пустые строки
    [[ "$line" =~ ^# || -z "$line" ]] && continue

    # Разбиваем строку на компоненты
    read -r action name path repo <<< "$line"

    # Проверяем обязательные параметры
    if [[ -z "$repo" || -z "$path" ]]; then
        echo "Error: Invalid entry - $line" >&2
        FAILED_SUBMODULES+=("$repo")
        continue
    fi

    if [[ "$action" == "+" ]]; then
        # Проверяем, существует ли уже субмодуль по указанному пути
        if submodule_exists "$path"; then
            printf '\e[33mСубмодуль %s уже существует, пропускаем.\e[0m\n' "$path"
            continue
        fi

        # Формируем команду
        cmd="git submodule add $repo $path"
        echo "Executing: $cmd"
        if eval "$cmd"; then
            echo "✅ Successfully added: $repo"
            ADDED_SUBMODULES+=("$repo")
        else
            echo "❌ Failed to add: $repo" >&2
            FAILED_SUBMODULES+=("$repo")
        fi
    elif [[ "$action" == "-" ]]; then
        # Здесь можно добавить логику для удаления субмодуля
        if submodule_exists "$path"; then
            cmd="git submodule deinit $path && git rm $path"
            echo "Executing: $cmd"
            if eval "$cmd"; then
                echo "✅ Successfully removed: $path"
                REMOVED_SUBMODULES+=("$path")
            else
                echo "❌ Failed to remove: $path" >&2
            fi
        else
            echo "Субмодуля $path нет, удалять нечего."
        fi
    fi
done < "$CONFIG_FILE"

# Сортируем .gitmodules
awk 'BEGIN { I=0 ; J=0 ; K="" } ; /^\[submodule/{ N+=1 ; J=1 ; K=$2 ; gsub(/("vendor\/|["\]])/, "", K) } ; { print K, N, J, $0 } ; { J+=1 }' .gitmodules \
    | sort \
    | awk '{ $1="" ; $2="" ; $3="" ; print }' \
    | sed 's/^ *//g' \
    | awk '/^\[/{ print ; next } { print "\t" $0 }' \
    > .gitmodules.sorted

# Вывод результатов
if [ "${#ADDED_SUBMODULES[@]}" -gt 0 ]; then
  echo 'Добавленные субмодули:'
  printf '\e[32m%s\e[0m\n' "${ADDED_SUBMODULES[@]}"
fi

if [ "${#REMOVED_SUBMODULES[@]}" -gt 0 ]; then
  echo 'Удалённые субмодули:'
  printf '\e[31m%s\e[0m\n' "${REMOVED_SUBMODULES[@]}"
fi

if [ "${#FAILED_SUBMODULES[@]}" -gt 0 ]; then
  echo 'Не удалось добавить субмодули:'
  printf '\e[33m%s\e[0m\n' "${FAILED_SUBMODULES[@]}"
fi

rm .gitmodules.tmp
cp .gitmodules.sorted .gitmodules
rm .gitmodules.sorted