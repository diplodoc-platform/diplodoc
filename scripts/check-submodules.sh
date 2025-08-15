#!/bin/bash

# Файл с исключениями
EXCEPTIONS_FILE=".gitmodules-ignore"
# Файл с текущими субмодулями
GITMODULES_FILE=".gitmodules"
# Выходной файл
SUBMODULES_CONF="submodules.conf"
# Временный файл для уникальных строк
TEMP_CONF="submodules.conf.tmp"

# Получаем список репозиториев из GitHub
REPOS_URL="https://api.github.com/orgs/diplodoc-platform/repos?per_page=100"
REPOS=$(curl -s $REPOS_URL | jq -r '.[] | [.name, .ssh_url] | @tsv' | sort)

# Читаем исключения
EXCEPTIONS=$(cat $EXCEPTIONS_FILE)

# Читаем текущие субмодули
CURRENT_SUBMODULES=$(grep 'submodule' $GITMODULES_FILE | sed 's/^\[submodule "\(.*\)"\]$/\1/' | sort)

# Сохраняем комментарии из начала файла submodules.conf
HEAD_COMMENTS=$(head -n $(grep -n '^[^#]' $SUBMODULES_CONF | cut -d: -f1 | head -n 1) $SUBMODULES_CONF)

# Очищаем временный файл и записываем комментарии
> $TEMP_CONF
echo "$HEAD_COMMENTS" >> $TEMP_CONF

# Функция для определения пути субмодуля
determine_path() {
    local repo_name=$1
    if [[ $repo_name == *"-action" ]]; then
        echo "actions/${repo_name%-action}"
    elif [[ $repo_name == *"-extension" ]]; then
        echo "extensions/${repo_name%-extension}"
    elif [[ -d "${repo_name}" ]]; then
        echo "${repo_name}"
    else
        # Поиск похожего пути среди существующих субмодулей
        for submodule in $CURRENT_SUBMODULES; do
            if [[ $submodule == *"$repo_name"* ]]; then
                echo "${submodule/$repo_name/$repo_name}"
                return
            fi
        done
        # По умолчанию добавляем в корень
        echo "$repo_name"
    fi
}

# Проходим по всем репозиториям и сравниваем с текущими субмодулями
while IFS=$'\t' read -r repo_name repo_url; do
    # Проверяем, не является ли репозиторий исключением
    if echo "$EXCEPTIONS" | grep -q -w "$repo_name"; then
        printf "\e[33m%s\e[0m игнорируется\n" "$repo_name"
        continue
    fi

    # Определяем путь для нового субмодуля
    submodule_path=$(determine_path "$repo_name")
    # Проверяем, есть ли репозиторий в текущих субмодулях
    if ! echo "$CURRENT_SUBMODULES" | grep -q -w "$submodule_path"; then
        # Формируем строку для добавления
        new_line="+ $submodule_path $submodule_path $repo_url"
        # Добавляем строку в временный файл, если её там ещё нет
        if ! grep -qF -- "$new_line" $TEMP_CONF; then
            echo "$new_line" >> $TEMP_CONF
            printf "\e[32m%s\e[0m есть в GitHub, но нет в .gitmodules\n" "$repo_name"
        fi
    fi
done <<< "$REPOS"

# Проверяем, какие субмодули есть в .gitmodules, но нет в GitHub
for submodule in $CURRENT_SUBMODULES; do
    submodule_name=$(basename $submodule)
    if ! echo "$REPOS" | grep -q -w "$submodule_name"; then
        # Ищем URL для субмодуля, который нужно удалить
        submodule_url=$(grep -A 2 "\[submodule \"$submodule\"\]" $GITMODULES_FILE | grep 'url =' | sed 's/url = //' | sed 's/^ *//')
        # Формируем строку для удаления
        remove_line="- $submodule $submodule $(echo $submodule_url | xargs)"
        # Добавляем строку в временный файл, если её там ещё нет
        if ! grep -qF -- "$remove_line" $TEMP_CONF; then
            echo "$remove_line" >> $TEMP_CONF
            printf "\e[31m%s\e[0m есть в .gitmodules, но нет в GitHub\n" "$submodule"
        fi
    fi
done

# Перезаписываем основной файл уникальными строками
mv $TEMP_CONF $SUBMODULES_CONF
