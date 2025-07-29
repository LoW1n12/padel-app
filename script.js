// webapp/script.js
const API_BASE_URL = "https://curly-birds-matter.loca.lt"; // НЕ ЗАБУДЬТЕ ЗАМЕНИТЬ!

document.addEventListener('DOMContentLoaded', () => {
    const tg = window.Telegram.WebApp;
    tg.expand();

    // --- Переменные и элементы DOM ---
    let currentLocation = null;
    const locationSelector = document.getElementById('location-selector');
    const calendarContainer = document.getElementById('calendar-container');
    const detailsModal = document.getElementById('details-modal');
    const closeModalBtn = document.querySelector('.close-button');
    const loader = document.getElementById('loader');
    const locationList = document.getElementById('location-list');
    const calendarEl = document.getElementById('calendar');
    const modalContent = document.getElementById('modal-details-content');

    // Показываем/скрываем загрузчик
    function setLoading(isLoading) {
        loader.style.display = isLoading ? 'flex' : 'none';
    }

    // --- Логика переключения экранов ---
    function showScreen(screen) {
        locationSelector.style.display = 'none';
        calendarContainer.style.display = 'none';

        if (screen === 'locations') {
            locationSelector.style.display = 'block';
            tg.BackButton.hide();
        } else if (screen === 'calendar') {
            calendarContainer.style.display = 'block';
            tg.BackButton.show();
        }
    }

    // --- Начальная загрузка ---
    // ИЗМЕНЕНО: Динамически загружаем локации с бэкенда
    async function loadLocations() {
        setLoading(true);
        try {
            const response = await fetch('/api/locations');
            if (!response.ok) throw new Error('Failed to fetch locations');

            const data = await response.json();
            locationList.innerHTML = ''; // Очищаем список

            data.locations.forEach(loc => {
                const button = document.createElement('button');
                button.className = 'location-btn';
                button.textContent = loc.name;
                button.dataset.locationId = loc.id;

                button.addEventListener('click', () => {
                    currentLocation = loc.id;
                    showScreen('calendar');
                    showCalendar(currentLocation);
                });
                locationList.appendChild(button);
            });
            showScreen('locations');
        } catch (error) {
            console.error('Error loading locations:', error);
            locationList.innerHTML = '<p>Не удалось загрузить локации. Попробуйте позже.</p>';
        } finally {
            setLoading(false);
        }
    }

    // --- Кнопка "Назад" в Telegram ---
    tg.BackButton.onClick(() => {
        if (calendarContainer.style.display === 'block') {
            showScreen('locations');
        }
    });

    // --- Логика календаря ---

    // ИЗМЕНЕНО: Запрос к реальному API для получения свободных дат
    async function fetchAvailableDates(location) {
        const response = await fetch(`/api/calendar?location=${location}`);
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        const data = await response.json();
        return data.available_dates || [];
    }

    // Основная функция для отображения календаря (логика отрисовки осталась прежней)
    async function showCalendar(location) {
        calendarEl.innerHTML = '';
        setLoading(true);

        try {
            const availableDates = await fetchAvailableDates(location);

            const today = new Date();
            const currentYear = today.getFullYear();
            const currentMonth = today.getMonth();

            renderMonth(calendarEl, currentYear, currentMonth, availableDates, today.getDate());

            const nextMonthDate = new Date(currentYear, currentMonth + 1, 1);
            renderMonth(calendarEl, nextMonthDate.getFullYear(), nextMonthDate.getMonth(), availableDates);

        } catch (error) {
            console.error('Failed to load calendar data:', error);
            calendarEl.textContent = 'Не удалось загрузить данные. Попробуйте позже.';
        } finally {
            setLoading(false);
        }
    }

    // Функция отрисовки месяца (без изменений)
    function renderMonth(container, year, month, availableDates, startDay = 1) {
        const monthName = new Date(year, month).toLocaleString('ru-RU', { month: 'long' });
        const monthHeader = document.createElement('h3');
        monthHeader.className = 'month-header';
        monthHeader.textContent = `${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${year}`;
        container.appendChild(monthHeader);

        const weekdaysContainer = document.createElement('div');
        weekdaysContainer.className = 'weekdays';
        ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].forEach(day => {
            const weekdayEl = document.createElement('div');
            weekdayEl.textContent = day;
            weekdaysContainer.appendChild(weekdayEl);
        });
        container.appendChild(weekdaysContainer);

        const daysGrid = document.createElement('div');
        daysGrid.className = 'calendar-grid';

        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const firstDayOfWeek = (new Date(year, month, 1).getDay() + 6) % 7;

        for (let i = 0; i < firstDayOfWeek; i++) {
            daysGrid.appendChild(document.createElement('div'));
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const dayCell = document.createElement('div');
            dayCell.className = 'calendar-day';

            if (new Date(year, month, day) < new Date().setHours(0,0,0,0) && day < startDay) {
                 dayCell.classList.add('past');
            }

            dayCell.textContent = day;
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

            if (availableDates.includes(dateStr)) {
                dayCell.classList.add('available');
                dayCell.dataset.date = dateStr;
                dayCell.addEventListener('click', () => showDayDetails(currentLocation, dateStr));
            }
            daysGrid.appendChild(dayCell);
        }
        container.appendChild(daysGrid);
    }

    // --- Логика модального окна и подписки ---

    // ИЗМЕНЕНО: Запрос к реальному API для получения слотов на день
    async function fetchDayDetails(location, date) {
        const response = await fetch(`/api/sessions?location=${location}&date=${date}`);
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        // Ваш API возвращает просто массив слотов, а не объект {slots: [...]},
        // поэтому обрабатываем напрямую.
        return response.json();
    }

    // ИЗМЕНЕНО: Функция отправки запроса на подписку
    async function handleSubscription(date) {
        setLoading(true);
        try {
            // Формируем тело запроса как ожидает ваш API
            const payload = {
                initData: tg.initData,
                subscription: {
                    location: currentLocation,
                    // ВАЖНО: Текущий UI не позволяет выбрать время и тип корта.
                    // Отправляем "универсальные" значения.
                    // Вам нужно будет доработать UI для детальной подписки.
                    hour: "any",
                    court_types: ["any"],
                    monitor_data: {
                        type: "specific_days", // Или 'specific_days' в зависимости от логики бэкенда
                        dates: [date]
                    }
                }
            };

            const response = await fetch('/api/subscribe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to subscribe');
            }

            // Показываем уведомление об успехе и закрываем Mini App
            tg.showPopup({
                title: 'Успех!',
                message: `Вы подписались на уведомления на ${date}.`,
                buttons: [{ type: 'ok', text: 'Отлично' }]
            }, () => tg.close());

        } catch (error) {
            console.error('Subscription failed:', error);
            tg.showAlert(`Ошибка подписки: ${error.message}`);
        } finally {
            setLoading(false);
        }
    }

    async function showDayDetails(location, date) {
        setLoading(true);
        modalContent.innerHTML = '';

        try {
            const slots = await fetchDayDetails(location, date);
            const formattedDate = new Date(date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

            let html = `<h4>Свободно ${formattedDate}</h4>`;
            if (slots && slots.length > 0) {
                html += '<ul>';
                slots.forEach(slot => {
                    html += `<li><strong>${slot.time}</strong> - ${slot.court} (${slot.price})</li>`;
                });
                html += '</ul>';
            } else {
                html += '<p>Нет свободных слотов на эту дату.</p>';
            }

            html += `<button id="subscribe-btn" class="subscribe-btn" data-date="${date}">Подписаться на эту дату</button>`;

            modalContent.innerHTML = html;
            detailsModal.style.display = 'block';

            document.getElementById('subscribe-btn').addEventListener('click', function() {
                const dateToSubscribe = this.dataset.date;
                handleSubscription(dateToSubscribe);
            });

        } catch (error) {
            console.error('Failed to load day details:', error);
            modalContent.textContent = 'Не удалось загрузить детали.';
            detailsModal.style.display = 'block';
        } finally {
            setLoading(false);
        }
    }

    // Закрытие модального окна
    closeModalBtn.addEventListener('click', () => {
        detailsModal.style.display = 'none';
    });
    window.addEventListener('click', (event) => {
        if (event.target == detailsModal) {
            detailsModal.style.display = 'none';
        }
    });

    // --- Запускаем приложение ---
    loadLocations();
});
