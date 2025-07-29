// webapp/script.js
const API_BASE_URL = "https://curly-birds-matter.loca.lt"; // НЕ ЗАБУДЬТЕ ЗАМЕНИТЬ!

document.addEventListener('DOMContentLoaded', () => {
    const tg = window.Telegram.WebApp;
    tg.ready();
    tg.expand();
    tg.BackButton.hide();

    document.body.style.backgroundColor = tg.themeParams.bg_color || '#f0f3f8';

    // UI Элементы
    const screens = {
        location: document.getElementById('location-screen'),
        calendar: document.getElementById('calendar-screen'),
    };
    const modal = {
        overlay: document.getElementById('detail-modal'),
        dateHeader: document.getElementById('modal-date-header'),
        sessionsList: document.getElementById('modal-sessions-list'),
        closeBtn: document.getElementById('close-modal-btn'),
        notifyBtn: document.getElementById('add-notification-btn'),
    };
    const locationList = document.getElementById('location-list');
    const calendarContainer = document.getElementById('calendar-container');

    // Состояние приложения
    let state = {
        selectedLocation: null,
        availableDates: new Set(),
        selectedDateForModal: null,
    };

    function showScreen(screenName) {
        Object.values(screens).forEach(s => s.classList.remove('active'));
        screens[screenName].classList.add('active');
    }

    async function fetchAPI(path) {
        const response = await fetch(`${API_BASE_URL}${path}`, { headers: { 'Bypass-Tunnel-Reminder': 'true' } });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return response.json();
    }

    async function fetchLocations() {
        try {
            const data = await fetchAPI('/api/locations');
            renderLocations(data.locations);
        } catch (error) {
            locationList.innerHTML = '<div class="location-card"><h2>Ошибка</h2><p>Не удалось загрузить локации. Убедитесь, что бот и туннель запущены.</p></div>';
        }
    }

    async function fetchCalendarDataAndRender() {
        if (!state.selectedLocation) return;
        calendarContainer.innerHTML = 'Загрузка календаря...';
        try {
            const data = await fetchAPI(`/api/calendar?location=${encodeURIComponent(state.selectedLocation)}`);
            state.availableDates = new Set(data.available_dates);
            renderRollingCalendar(40); // Отображаем 40 дней
        } catch (error) { console.error('Ошибка загрузки данных для календаря:', error); }
    }

    function renderLocations(locations) {
        locationList.innerHTML = '';
        locations.forEach(loc => {
            const card = document.createElement('div');
            card.className = 'location-card';
            card.innerHTML = `<h2>${loc.name}</h2><p>${loc.description}</p>`;
            card.addEventListener('click', () => {
                state.selectedLocation = loc.id;
                document.getElementById('calendar-location-header').textContent = loc.name;
                fetchCalendarDataAndRender();
                showScreen('calendar');
                tg.BackButton.show();
            });
            locationList.appendChild(card);
        });
    }

    function renderRollingCalendar(daysToShow) {
        calendarContainer.innerHTML = '';
        let currentMonth = -1;

        for (let i = 0; i < daysToShow; i++) {
            const date = new Date();
            date.setDate(date.getDate() + i);

            // Если начинается новый месяц, добавляем заголовок
            if (date.getMonth() !== currentMonth) {
                currentMonth = date.getMonth();
                const monthHeader = document.createElement('div');
                monthHeader.className = 'month-header';
                monthHeader.innerHTML = `<h2>${date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}</h2>`;
                calendarContainer.appendChild(monthHeader);

                const weekdaysGrid = document.createElement('div');
                weekdaysGrid.className = 'weekdays-grid';
                weekdaysGrid.innerHTML = '<div>Пн</div><div>Вт</div><div>Ср</div><div>Чт</div><div>Пт</div><div>Сб</div><div>Вс</div>';
                calendarContainer.appendChild(weekdaysGrid);

                const grid = document.createElement('div');
                grid.className = 'calendar-grid';
                calendarContainer.appendChild(grid);

                // Добавляем пустые ячейки для дней недели до 1-го числа
                let dayOfWeek = date.getDay();
                if (dayOfWeek === 0) dayOfWeek = 7;
                for (let j = 1; j < dayOfWeek; j++) {
                    grid.appendChild(document.createElement('div'));
                }
            }

            const grid = calendarContainer.querySelector('.calendar-grid:last-child');
            const dayCell = document.createElement('div');
            dayCell.className = 'calendar-day';
            const fullDateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

            const span = document.createElement('span');
            span.textContent = date.getDate();
            dayCell.appendChild(span);

            if (i === 0) { // Сегодня
                dayCell.classList.add('is-today');
            }

            if (state.availableDates.has(fullDateStr)) {
                dayCell.classList.add('has-sessions', 'is-active');
                dayCell.addEventListener('click', () => onDateClick(fullDateStr));
            } else {
                dayCell.classList.add('is-disabled');
            }
            grid.appendChild(dayCell);
        }
    }

    async function onDateClick(dateStr) {
        state.selectedDateForModal = dateStr;
        modal.dateHeader.textContent = new Date(dateStr).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
        modal.sessionsList.innerHTML = '<div class="list-item" style="justify-content:center;">Загрузка...</div>';
        modal.overlay.classList.add('visible');

        try {
            const data = await fetchAPI(`/api/sessions?location=${encodeURIComponent(state.selectedLocation)}&date=${dateStr}`);
            renderModalSessions(data);
        } catch (error) {
            modal.sessionsList.innerHTML = '<div class="list-item" style="justify-content:center;">Ошибка загрузки</div>';
        }
    }

    function renderModalSessions(data) {
        modal.sessionsList.innerHTML = '';
        const sortedTimes = Object.keys(data).sort();
        if (sortedTimes.length === 0) {
            modal.sessionsList.innerHTML = '<div class="list-item" style="justify-content:center;">Свободных сеансов нет</div>';
            return;
        }
        const listWrapper = document.createElement('div');
        listWrapper.style.padding = '0 16px 16px';
        const list = document.createElement('div');
        list.style.borderRadius = '12px';
        list.style.overflow = 'hidden';

        sortedTimes.forEach(time => {
            const courtData = data[time];
            let details = Object.entries(courtData).map(([type, info]) => `${type} - ${info.price} ₽`).join(' | ');
            const item = document.createElement('div');
            item.className = 'list-item';
            item.innerHTML = `<div class="list-item-title">${time}</div><div class="list-item-subtitle">${details}</div>`;
            list.appendChild(item);
        });
        listWrapper.appendChild(list);
        modal.sessionsList.appendChild(listWrapper);
    }

    function closeModal() {
        modal.overlay.classList.remove('visible');
    }

    async function onConfirmNotification() {
        tg.MainButton.showProgress();
        const subscription = {
            location: state.selectedLocation, hour: -1,
            court_types: ["Корт для 4-х", "Корт для 2-х", "Открытый корт", "Закрытый корт", "Корт (тип 1)", "Корт (тип 2)", "Ultra корт", "Корт"],
            monitor_data: { type: "specific", value: state.selectedDateForModal }
        };
        try {
            const response = await fetch(`${API_BASE_URL}/api/subscribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Bypass-Tunnel-Reminder': 'true' },
                body: JSON.stringify({ initData: tg.initData, subscription: subscription })
            });
            if (!response.ok) throw new Error('Subscription failed');
            tg.showAlert('Уведомление успешно добавлено!');
        } catch (error) {
            tg.showAlert('Не удалось добавить уведомление.');
        } finally {
            tg.MainButton.hideProgress();
            tg.MainButton.hide();
            tg.MainButton.offClick(onConfirmNotification);
            closeModal();
        }
    }

    tg.onEvent('backButtonClicked', () => { showScreen('location'); tg.BackButton.hide(); });
    modal.closeBtn.addEventListener('click', closeModal);
    modal.overlay.addEventListener('click', (e) => { if (e.target === modal.overlay) closeModal(); });
    modal.notifyBtn.addEventListener('click', () => {
        tg.MainButton.setText(`Подтвердить на ${new Date(state.selectedDateForModal).toLocaleDateString('ru-RU', {day: 'numeric', month: 'short'})}`);
        tg.MainButton.show();
        tg.MainButton.onClick(onConfirmNotification);
    });

    fetchLocations();
});
