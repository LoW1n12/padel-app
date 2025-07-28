// webapp/script.js
const API_BASE_URL = "https://long-moons-march.loca.lt"; // НЕ ЗАБУДЬТЕ ЗАМЕНИТЬ!

document.addEventListener('DOMContentLoaded', () => {
    const tg = window.Telegram.WebApp;
    tg.ready();
    tg.expand();
    tg.BackButton.hide();

    document.body.style.backgroundColor = tg.themeParams.bg_color || '#f0f3f8';

    // Экраны и UI
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
    const calendarGrid = document.getElementById('calendar-grid');
    const monthYearHeader = document.getElementById('month-year-header');
    const calendarLocationHeader = document.getElementById('calendar-location-header');
    const prevMonthBtn = document.getElementById('prev-month-btn');
    const nextMonthBtn = document.getElementById('next-month-btn');

    let state = {
        selectedLocation: null,
        displayDate: new Date(),
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

    async function fetchCalendarData() {
        if (!state.selectedLocation) return;
        calendarGrid.innerHTML = '';
        try {
            const data = await fetchAPI(`/api/calendar?location=${encodeURIComponent(state.selectedLocation)}`);
            state.availableDates = new Set(data.available_dates);
            renderCurrentMonth();
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
                calendarLocationHeader.textContent = loc.name;
                state.displayDate = new Date(); // Сбрасываем на текущий месяц
                fetchCalendarData();
                showScreen('calendar');
                tg.BackButton.show();
            });
            locationList.appendChild(card);
        });
    }

    function renderCurrentMonth() {
        renderCalendar(state.displayDate.getFullYear(), state.displayDate.getMonth());
    }

    function renderCalendar(year, month) {
        calendarGrid.innerHTML = '';
        monthYearHeader.textContent = new Date(year, month).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });

        const firstDayOfMonth = new Date(year, month, 1);
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const today = new Date();

        let dayOfWeek = firstDayOfMonth.getDay();
        if (dayOfWeek === 0) dayOfWeek = 7; // Вс = 7

        for (let i = 1; i < dayOfWeek; i++) {
            calendarGrid.appendChild(document.createElement('div'));
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const dayCell = document.createElement('div');
            dayCell.className = 'calendar-day is-in-month';
            const fullDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

            const span = document.createElement('span');
            span.textContent = day;
            dayCell.appendChild(span);

            if (day === today.getDate() && year === today.getFullYear() && month === today.getMonth()) {
                dayCell.classList.add('is-today');
            }

            if (state.availableDates.has(fullDateStr)) {
                dayCell.classList.add('has-sessions');
                dayCell.addEventListener('click', () => onDateClick(fullDateStr));
            } else {
                dayCell.classList.add('is-disabled');
            }
            calendarGrid.appendChild(dayCell);
        }
    }

    async function onDateClick(dateStr) {
        state.selectedDateForModal = dateStr;
        modal.dateHeader.textContent = new Date(dateStr).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
        modal.sessionsList.innerHTML = '<div class="list-item">Загрузка...</div>';
        modal.overlay.classList.add('visible');

        try {
            const data = await fetchAPI(`/api/sessions?location=${encodeURIComponent(state.selectedLocation)}&date=${dateStr}`);
            renderModalSessions(data);
        } catch (error) {
            modal.sessionsList.innerHTML = '<div class="list-item">Ошибка загрузки</div>';
        }
    }

    function renderModalSessions(data) {
        modal.sessionsList.innerHTML = '';
        const sortedTimes = Object.keys(data).sort();
        if (sortedTimes.length === 0) {
            modal.sessionsList.innerHTML = '<div class="list-item">Свободных сеансов нет</div>';
            return;
        }
        sortedTimes.forEach(time => {
            const courtData = data[time];
            let details = Object.entries(courtData).map(([type, info]) => `${type} - ${info.price} ₽`).join(' | ');
            const item = document.createElement('div');
            item.className = 'list-item';
            item.innerHTML = `<div class="list-item-title">${time}</div><div class="list-item-subtitle">${details}</div>`;
            modal.sessionsList.appendChild(item);
        });
    }

    function closeModal() {
        modal.overlay.classList.remove('visible');
    }

    // --- Обработчики событий ---
    tg.onEvent('backButtonClicked', () => {
        showScreen('location');
        tg.BackButton.hide();
    });

    prevMonthBtn.addEventListener('click', () => {
        state.displayDate.setMonth(state.displayDate.getMonth() - 1);
        renderCurrentMonth();
    });
    nextMonthBtn.addEventListener('click', () => {
        state.displayDate.setMonth(state.displayDate.getMonth() + 1);
        renderCurrentMonth();
    });

    modal.closeBtn.addEventListener('click', closeModal);
    modal.overlay.addEventListener('click', (e) => { if (e.target === modal.overlay) closeModal(); });

    async function onConfirmNotification() {
        const subscription = {
            location: state.selectedLocation, hour: -1,
            court_types: ["Корт для 4-х", "Корт для 2-х", "Открытый корт", "Закрытый корт", "Корт (тип 1)", "Корт (тип 2)", "Ultra корт", "Корт"],
            monitor_data: { type: "specific", value: state.selectedDateForModal }
        };
        try {
            await fetch(`${API_BASE_URL}/api/subscribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Bypass-Tunnel-Reminder': 'true' },
                body: JSON.stringify({ initData: tg.initData, subscription: subscription })
            });
            tg.showAlert('Уведомление успешно добавлено!');
        } catch (error) {
            tg.showAlert('Не удалось добавить уведомление.');
        } finally {
            tg.MainButton.hide();
            tg.MainButton.offClick(onConfirmNotification);
            closeModal();
        }
    }

    modal.notifyBtn.addEventListener('click', () => {
        tg.MainButton.setText(`Подтвердить на ${new Date(state.selectedDateForModal).toLocaleDateString('ru-RU', {day: 'numeric', month: 'short'})}`);
        tg.MainButton.show();
        tg.MainButton.onClick(onConfirmNotification);
    });

    // --- Инициализация ---
    fetchLocations();
});
