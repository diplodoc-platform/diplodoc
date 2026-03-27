#!/usr/bin/env node

/**
 * Скрипт для копирования содержимого папки docs по указанному пути
 * с последующим сбросом репозитория к исходному состоянию
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, cpSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Получаем корневую директорию проекта
const PROJECT_ROOT = resolve(__dirname);
const DOCS_DIR = resolve(PROJECT_ROOT, 'make-docs-better');

/**
 * Выполняет команду shell и возвращает результат
 */
function exec(command, options = {}) {
    try {
        return execSync(command, {
            encoding: 'utf-8',
            stdio: 'inherit',
            ...options,
        });
    } catch (error) {
        throw new Error(`Ошибка выполнения команды: ${command}\n${error.message}`);
    }
}

/**
 * Проверяет наличие изменений в репозитории
 */
function hasChanges() {
    try {
        const status = execSync('git status --porcelain', {
            encoding: 'utf-8',
            cwd: PROJECT_ROOT,
        });
        return status.trim().length > 0;
    } catch (error) {
        return false;
    }
}

/**
 * Сбрасывает репозиторий к исходному состоянию
 */
function resetRepository() {
    console.log('\n🔄 Сброс репозитория к исходному состоянию...');
    
    try {
        // Сбрасываем изменения в отслеживаемых файлах
        exec('git reset --hard', { cwd: PROJECT_ROOT });
        
        // Удаляем неотслеживаемые файлы и директории
        exec('git clean -fd', { cwd: PROJECT_ROOT });
        
        console.log('✅ Репозиторий успешно сброшен');
    } catch (error) {
        console.error('❌ Ошибка при сбросе репозитория:', error.message);
        throw error;
    }
}

/**
 * Копирует содержимое папки docs в целевую директорию
 */
function copyDocs(targetPath) {
    const absoluteTargetPath = resolve(targetPath);
    
    // console.log(`\n📂 Копирование папки docs в: ${absoluteTargetPath}`);
    
    // Проверяем существование исходной папки
    if (!existsSync(DOCS_DIR)) {
        throw new Error(`Папка docs не найдена: ${DOCS_DIR}`);
    }
    
    // Создаем целевую директорию, если она не существует
    if (!existsSync(absoluteTargetPath)) {
        mkdirSync(absoluteTargetPath, { recursive: true });
        console.log(`📁 Создана директория`);
    }
    
    try {
        // Копируем содержимое папки docs
        cpSync(DOCS_DIR, absoluteTargetPath, {
            recursive: true,
            preserveTimestamps: true,
        });
        
        console.log('✅ Копирование завершено успешно');
    } catch (error) {
        console.error('❌ Ошибка при копировании:', error.message);
        throw error;
    }
}

/**
 * Основная функция
 */
function main() {
    console.log('🚀 Скрипт копирования docs с последующим сбросом репозитория\n');
    
    // Проверяем наличие изменений перед началом
    if (hasChanges()) {
        console.log('⚠️  В репозитории есть незакоммиченные изменения:');
        exec('git status --short', { cwd: PROJECT_ROOT });
        console.log('\nЭти изменения будут потеряны после сброса репозитория.');
    }
    
    // Получаем путь от пользователя
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.error('❌ Ошибка: не указан путь для копирования. Введите например ник из телеги (без спец символов)');
        process.exit(1);
    }
    
    const targetPath = join(homedir(), '.TWD', args[0]);
    
    try {
        // Копируем папку docs
        copyDocs(targetPath);
        
        // Сбрасываем репозиторий
        resetRepository();
        
        console.log('\n✨ Операция завершена успешно!');
        console.log(`📦 Документация скопирована`);
        console.log('🔄 Репозиторий сброшен к исходному состоянию');
    } catch (error) {
        console.error('\n❌ Операция завершилась с ошибкой:', error.message);
        console.log('\n⚠️  Репозиторий НЕ был сброшен из-за ошибки копирования');
        process.exit(1);
    }
}

// Запускаем скрипт
main();
