#!/usr/bin/env python3
"""
TikTok String Builder
Небольшое десктоп-приложение на PySide6 для быстрой сборки строки,
которую потом нужно вставить в панель "TT Helper LIGHT" в TikTok Studio.

Формат итоговой строки:
    <path> | <tags> | <date> | <caption>

Где:
    path    — абсолютный путь к видеофайлу (обязательно)
    tags    — хештеги через пробел, например "#cats #funny"
    date    — дата публикации "YYYY-MM-DD HH:MM" (можно пусто)
    caption — описание ролика (можно пусто)
"""

import os
import sys

from PySide6.QtCore import Qt, QDateTime
from PySide6.QtGui import QGuiApplication, QIcon, QAction, QKeySequence
from PySide6.QtWidgets import (
    QApplication,
    QCheckBox,
    QDateTimeEdit,
    QFileDialog,
    QFormLayout,
    QFrame,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QPlainTextEdit,
    QSizePolicy,
    QStatusBar,
    QVBoxLayout,
    QWidget,
)


DARK_QSS = """
QWidget {
    background-color: #18181b;
    color: #e5e7eb;
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 13px;
}
QFrame#Card {
    background-color: #09090b;
    border: 1px solid #3f3f46;
    border-radius: 10px;
}
QLabel#Title {
    color: #ffffff;
    font-size: 18px;
    font-weight: 700;
}
QLabel#Subtitle {
    color: #a1a1aa;
    font-size: 12px;
}
QLabel[role="field"] {
    color: #d4d4d8;
    font-weight: 600;
}
QLineEdit, QPlainTextEdit, QDateTimeEdit {
    background-color: #09090b;
    border: 1px solid #3f3f46;
    border-radius: 8px;
    padding: 6px 8px;
    color: #e5e7eb;
    selection-background-color: #4f46e5;
}
QLineEdit:focus, QPlainTextEdit:focus, QDateTimeEdit:focus {
    border: 1px solid #6366f1;
}
QPushButton {
    background-color: #27272a;
    color: #e5e7eb;
    border: none;
    border-radius: 8px;
    padding: 8px 14px;
    font-weight: 600;
}
QPushButton:hover {
    background-color: #3f3f46;
}
QPushButton:pressed {
    background-color: #52525b;
}
QPushButton#Primary {
    background-color: #4f46e5;
    color: #ffffff;
}
QPushButton#Primary:hover {
    background-color: #4338ca;
}
QPushButton#Primary:pressed {
    background-color: #3730a3;
}
QCheckBox {
    color: #d4d4d8;
}
QStatusBar {
    background: #09090b;
    color: #a1a1aa;
}
"""


class StringBuilder(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("TikTok String Builder")
        self.resize(560, 560)
        self.setMinimumSize(480, 520)

        central = QWidget(self)
        self.setCentralWidget(central)

        root = QVBoxLayout(central)
        root.setContentsMargins(16, 16, 16, 16)
        root.setSpacing(12)

        # ---------- Header ----------
        title = QLabel("TikTok String Builder")
        title.setObjectName("Title")
        subtitle = QLabel("Собери строку для панели TT Helper LIGHT и скопируй её одной кнопкой.")
        subtitle.setObjectName("Subtitle")
        subtitle.setWordWrap(True)
        root.addWidget(title)
        root.addWidget(subtitle)

        # ---------- Input card ----------
        card = QFrame()
        card.setObjectName("Card")
        form_layout = QFormLayout(card)
        form_layout.setContentsMargins(14, 14, 14, 14)
        form_layout.setSpacing(10)
        form_layout.setLabelAlignment(Qt.AlignLeft)

        # Path row
        self.path_edit = QLineEdit()
        self.path_edit.setPlaceholderText(r"D:\Videos\cat.mp4")
        browse_btn = QPushButton("Обзор…")
        browse_btn.clicked.connect(self.browse_file)
        path_row = QHBoxLayout()
        path_row.setSpacing(8)
        path_row.addWidget(self.path_edit, 1)
        path_row.addWidget(browse_btn)
        path_wrap = QWidget()
        path_wrap.setLayout(path_row)
        path_layout = path_wrap.layout()
        path_layout.setContentsMargins(0, 0, 0, 0)

        path_label = QLabel("Путь к видео*")
        path_label.setProperty("role", "field")
        form_layout.addRow(path_label, path_wrap)

        # Tags
        self.tags_edit = QLineEdit()
        self.tags_edit.setPlaceholderText("#cats #funny #pet")
        tags_label = QLabel("Хештеги")
        tags_label.setProperty("role", "field")
        form_layout.addRow(tags_label, self.tags_edit)

        # Date row: checkbox + QDateTimeEdit
        self.date_check = QCheckBox("Запланировать публикацию")
        self.date_check.stateChanged.connect(self.on_date_toggle)
        self.date_edit = QDateTimeEdit()
        self.date_edit.setDisplayFormat("yyyy-MM-dd HH:mm")
        self.date_edit.setCalendarPopup(True)
        self.date_edit.setDateTime(QDateTime.currentDateTime().addSecs(60 * 60))
        self.date_edit.setEnabled(False)

        date_wrap = QWidget()
        date_row = QHBoxLayout(date_wrap)
        date_row.setContentsMargins(0, 0, 0, 0)
        date_row.setSpacing(8)
        date_row.addWidget(self.date_check)
        date_row.addWidget(self.date_edit, 1)

        date_label = QLabel("Дата / время")
        date_label.setProperty("role", "field")
        form_layout.addRow(date_label, date_wrap)

        # Caption
        self.caption_edit = QPlainTextEdit()
        self.caption_edit.setPlaceholderText("Мой кот делает что-то смешное")
        self.caption_edit.setFixedHeight(70)
        caption_label = QLabel("Описание")
        caption_label.setProperty("role", "field")
        form_layout.addRow(caption_label, self.caption_edit)

        root.addWidget(card)

        # ---------- Preview ----------
        preview_card = QFrame()
        preview_card.setObjectName("Card")
        pv_layout = QVBoxLayout(preview_card)
        pv_layout.setContentsMargins(14, 14, 14, 14)
        pv_layout.setSpacing(8)

        pv_title = QLabel("Готовая строка")
        pv_title.setProperty("role", "field")
        self.preview = QPlainTextEdit()
        self.preview.setReadOnly(True)
        self.preview.setFixedHeight(80)
        self.preview.setPlaceholderText("Здесь появится строка для вставки в панель TikTok Studio.")

        pv_layout.addWidget(pv_title)
        pv_layout.addWidget(self.preview)

        root.addWidget(preview_card)

        # ---------- Action row ----------
        actions = QHBoxLayout()
        actions.setSpacing(8)

        build_btn = QPushButton("Собрать строку")
        build_btn.clicked.connect(self.build_string)

        copy_btn = QPushButton("Скопировать")
        copy_btn.setObjectName("Primary")
        copy_btn.clicked.connect(self.copy_string)

        clear_btn = QPushButton("Очистить")
        clear_btn.clicked.connect(self.clear_all)

        actions.addWidget(build_btn)
        actions.addWidget(copy_btn)
        actions.addWidget(clear_btn)
        actions.addStretch(1)
        root.addLayout(actions)

        # ---------- Status bar ----------
        self.status = QStatusBar()
        self.setStatusBar(self.status)
        self.status.showMessage("Готов к работе.")

        # ---------- Shortcuts ----------
        build_act = QAction(self)
        build_act.setShortcut(QKeySequence("Ctrl+B"))
        build_act.triggered.connect(self.build_string)
        self.addAction(build_act)

        copy_act = QAction(self)
        copy_act.setShortcut(QKeySequence("Ctrl+Return"))
        copy_act.triggered.connect(self.copy_string)
        self.addAction(copy_act)

        # live rebuild
        self.path_edit.textChanged.connect(self.build_string)
        self.tags_edit.textChanged.connect(self.build_string)
        self.caption_edit.textChanged.connect(self.build_string)
        self.date_edit.dateTimeChanged.connect(self.build_string)
        self.date_check.stateChanged.connect(self.build_string)

    # ---------- Slots ----------
    def on_date_toggle(self, state: int) -> None:
        self.date_edit.setEnabled(bool(state))

    def browse_file(self) -> None:
        start_dir = ""
        current = self.path_edit.text().strip()
        if current and os.path.isfile(current):
            start_dir = os.path.dirname(current)
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "Выбери видеофайл",
            start_dir,
            "Видео (*.mp4 *.mov *.avi *.mkv *.webm);;Все файлы (*)",
        )
        if file_path:
            self.path_edit.setText(file_path)

    def normalize_tags(self, raw: str) -> str:
        raw = (raw or "").strip()
        if not raw:
            return ""
        parts = [p.strip() for p in raw.replace(",", " ").split() if p.strip()]
        fixed = []
        for p in parts:
            if not p.startswith("#"):
                p = "#" + p.lstrip("#")
            fixed.append(p)
        return " ".join(fixed)

    def build_string(self) -> str:
        path = self.path_edit.text().strip()
        tags = self.normalize_tags(self.tags_edit.text())
        date = ""
        if self.date_check.isChecked():
            date = self.date_edit.dateTime().toString("yyyy-MM-dd HH:mm")
        caption = self.caption_edit.toPlainText().strip().replace("\n", " ")

        # Убираем разделитель | из полей, чтобы не ломать парсер
        path = path.replace("|", "/")
        tags = tags.replace("|", " ")
        caption = caption.replace("|", "/")

        parts = [path, tags, date, caption]
        # Убираем хвостовые пустые поля, но сохраняем порядок
        while parts and parts[-1] == "":
            parts.pop()

        result = " | ".join(parts)
        self.preview.setPlainText(result)
        return result

    def copy_string(self) -> None:
        text = self.build_string()
        if not text:
            QMessageBox.warning(self, "Пусто", "Сначала укажи хотя бы путь к видеофайлу.")
            return
        if not self.path_edit.text().strip():
            QMessageBox.warning(self, "Нет пути", "Поле «Путь к видео» обязательное.")
            return
        QGuiApplication.clipboard().setText(text)
        self.status.showMessage("Строка скопирована в буфер обмена.", 4000)

    def clear_all(self) -> None:
        self.path_edit.clear()
        self.tags_edit.clear()
        self.caption_edit.clear()
        self.date_check.setChecked(False)
        self.date_edit.setDateTime(QDateTime.currentDateTime().addSecs(60 * 60))
        self.preview.clear()
        self.status.showMessage("Очищено.", 2000)


def main() -> int:
    app = QApplication(sys.argv)
    app.setStyleSheet(DARK_QSS)
    app.setApplicationName("TikTok String Builder")
    window = StringBuilder()
    window.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
