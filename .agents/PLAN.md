# План масштабирования документации для агентов в Diplodoc

## Цель

Создать структурированную документацию для AI агентов во всех компонентах проекта Diplodoc, используя подход, разработанный в репозитории `models`.

## Текущее состояние

### ✅ Уже существует документация:
- `packages/cli/AGENTS.md` - подробная документация для CLI пакета
- `extensions/openapi/AGENTS.md` - документация для OpenAPI расширения

### 📋 Структура проекта Diplodoc:

1. **Метапакет (корневой)** - `/diplodoc/`
   - Workspace менеджер для всех подпроектов
   - Содержит общие скрипты и конфигурацию

2. **Сабмодули (отдельные репозитории)** - 39 штук:
   - **extensions/** (13): algolia, color, cut, file, folding-headings, html, latex, mermaid, openapi, page-constructor, quote-link, search, tabs
   - **packages/** (12): cli, client, components, directive, gh-docs, liquid, sentenizer, transform, translation, utils, yfmlint
   - **devops/** (4): infra, package-template, testpack, tsconfig
   - **Note**: `eslint-config` and `prettier-config` are deprecated; functionality merged into `lint`
   - **actions/** (6): docs-build, docs-build-static, docs-clean, docs-message, docs-release, docs-upload
   - **docs/** (1): пользовательская документация

**Важно**: ВСЕ пакеты являются сабмодулями. Нет "workspace пакетов" в классическом понимании - все это отдельные Git репозитории, связанные через npm workspaces для удобства разработки.

## Этапы выполнения

### Этап 1: Анализ и подготовка (Фаза 0) ✅

**Цель**: Понять структуру проекта и создать шаблоны

1. ✅ Изучить существующую документацию в `models/`
2. ✅ Изучить структуру `diplodoc/`
3. ✅ Проанализировать существующие `AGENTS.md` в diplodoc
4. ✅ Создать шаблоны для разных типов проектов:
   - ✅ Шаблон для метапакета (`docs/AGENTS/templates/TEMPLATE-METAPACKAGE.md`)
   - ✅ Шаблон для сабмодулей (`docs/AGENTS/templates/TEMPLATE-SUBMODULE.md`)
   - ✅ Шаблон для workspace пакетов (`docs/AGENTS/templates/TEMPLATE-WORKSPACE-PACKAGE.md`)
5. ✅ Определить общие разделы документации:
   - ✅ Общие разделы (`docs/AGENTS/templates/COMMON-SECTIONS.md`)
   - ✅ README для шаблонов (`docs/AGENTS/templates/README.md`)

### Этап 2: Документация для метапакета (Фаза 1) ✅

**Цель**: Создать корневую документацию для метапакета

1. ✅ Создать `/diplodoc/AGENTS.md` (индекс)
2. ✅ Создать `/diplodoc/.agents/` директорию (перенесено из docs/AGENTS/)
3. ✅ Создать разделы:
   - ✅ `core.md` - обзор платформы, метапакет структура, workspace конфигурация, сабмодули, extensions
   - ✅ `monorepo.md` - работа с метапакетом, сабмодули, workspace пакеты, зависимости
   - ✅ `dev-infrastructure.md` - общие инструменты, скрипты, тестирование, Nx
   - ✅ `style-and-testing.md` - общие стандарты кодирования и тестирования, коммиты
4. ✅ Создать `QUESTIONS.md` - файл с вопросами для уточнения
5. ✅ Создать `ANALYSIS.md` - анализ метапакета и найденные паттерны
6. ⏳ Расширить документы на основе ответов на вопросы

### Этап 3: Документация для сабмодулей (Фаза 2)

**Цель**: Создать документацию для всех 39 сабмодулей

**Приоритет 1** (критичные пакеты):
1. ⏳ `packages/cli` - ✅ уже есть, проверить актуальность
2. ⏳ `packages/transform` - ядро трансформации
3. ⏳ `packages/components` - UI компоненты
4. ⏳ `packages/liquid` - обработка шаблонов
5. ⏳ `packages/yfmlint` - линтер для YFM

**Приоритет 2** (важные extensions):
6. ⏳ `extensions/openapi` - ✅ уже есть, проверить актуальность
7. ⏳ `extensions/algolia` - поиск
8. ⏳ `extensions/cut` - collapsible sections
9. ⏳ `extensions/tabs` - табы
10. ⏳ `extensions/mermaid` - диаграммы

**Приоритет 3** (остальные extensions):
11. ⏳ `extensions/color`
12. ⏳ `extensions/file`
13. ⏳ `extensions/folding-headings`
14. ⏳ `extensions/html`
15. ⏳ `extensions/latex`
16. ⏳ `extensions/page-constructor`
17. ⏳ `extensions/quote-link`
18. ⏳ `extensions/search`

**Приоритет 4** (actions):
19. ⏳ `actions/docs-build`
20. ⏳ `actions/docs-build-static`
21. ⏳ `actions/docs-clean`
22. ⏳ `actions/docs-message`
23. ⏳ `actions/docs-release`
24. ⏳ `actions/docs-upload`

**Приоритет 5** (остальные packages):
25. ⏳ `packages/client`
26. ⏳ `packages/directive`
27. ⏳ `packages/gh-docs`
28. ⏳ `packages/sentenizer`
29. ⏳ `packages/translation`
30. ⏳ `packages/utils`

**Приоритет 6** (devops):
31. ⏳ `devops/testpack` - системные тесты
32. ⏳ `devops/infra` - инфраструктура (ранее devops/lint)
33. ⏳ `devops/tsconfig` - TypeScript конфиги
34. ⏳ Остальные devops пакеты (по необходимости)

Для каждого сабмодуля:
- Создать `AGENTS.md` в корне сабмодуля
- Использовать шаблон для сабмодулей
- Адаптировать под специфику проекта

### Этап 4: Удален (все пакеты - сабмодули)

**Примечание**: Все пакеты являются сабмодулями, поэтому Этап 4 объединен с Этапом 3.

### Этап 5: Создание bootstrap слоя (Фаза 4)

**Цель**: Выделить общие шаблоны и утилиты

1. ⏳ Создать `/diplodoc/bootstrap/` директорию (аналогично `models/bootstrap/`)
2. ⏳ Создать общие шаблоны документации
3. ⏳ Создать скрипты для генерации документации (опционально)
4. ⏳ Создать `bootstrap/AGENTS.md` с описанием шаблонов

### Этап 6: Валидация и улучшение (Фаза 5)

**Цель**: Проверить качество и полноту документации

1. ⏳ Проверить все созданные `AGENTS.md` на полноту
2. ⏳ Убедиться в консистентности стиля
3. ⏳ Обновить существующие `AGENTS.md` (cli, openapi) если нужно
4. ⏳ Создать чеклист для проверки документации

## Шаблоны документации

### Шаблон для метапакета

```
AGENTS.md (индекс)
docs/AGENTS/
  - core.md (обзор платформы, монорепо)
  - monorepo.md (сабмодули, workspace)
  - dev-infrastructure.md (общие инструменты)
  - style-and-testing.md (стандарты)
```

### Шаблон для сабмодуля

```
AGENTS.md
  - Project overview
  - Setup commands
  - Architecture (если применимо)
  - Development workflow
  - Testing
  - Key concepts
  - Common tasks
```

### Шаблон для workspace пакета

```
AGENTS.md
  - Project overview
  - Setup commands
  - Architecture
  - Development workflow
  - Testing
  - Key modules/concepts
  - Common tasks
```

## Критерии готовности

Для каждого компонента документация считается готовой, если:

- ✅ Создан `AGENTS.md` в корне компонента
- ✅ Описаны основные концепции проекта
- ✅ Описаны команды setup и development
- ✅ Описана архитектура (если применимо)
- ✅ Описаны стандарты кодирования
- ✅ Описаны процессы тестирования
- ✅ Описаны типичные задачи разработки
- ✅ Документация написана на английском языке
- ✅ Документация соответствует стилю из `models/`

## Приоритизация

**Высокий приоритет**:
- Метапакет (корневой)
- Критичные сабмодули (liquid, yfmlint, algolia)
- Основные workspace пакеты (cli, transform, components)

**Средний приоритет**:
- Actions (все 6)
- Остальные extensions
- Вспомогательные packages

**Низкий приоритет**:
- Devops пакеты (кроме testpack и lint)
- Мелкие утилиты

## Метрики прогресса

- Всего сабмодулей: 39
- С документацией: 2 (cli, openapi)
- Требуется создать: 37
- Extensions: 13
- Packages: 12
- Devops: 7
- Actions: 6
- Docs: 1

## Следующие шаги

1. Начать с Этапа 1 - создание шаблонов
2. Затем Этап 2 - документация метапакета
3. Постепенно покрывать сабмодули и workspace пакеты

