// Small native controls shared by construction and equipment editors.
// Components receive data/callbacks; they do not own or subscribe to game state.
export function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
export function numberField(label, id, value, min, max) {
  const row = el('label', 'field');
  row.append(el('span', 'field-label', label));
  const input = el('input');
  Object.assign(input, { id, type: 'number', min: String(min), max: String(max), step: '0.25', required: true, value: String(value) });
  row.append(input);
  return { row, input };
}
export function readVoxels(input) {
  if (!input.checkValidity() || !Number.isFinite(input.valueAsNumber)) {
    input.reportValidity();
    throw new Error('Проверь размеры и координаты: шаг 0,25 м');
  }
  const value = input.valueAsNumber * 4;
  if (!Number.isInteger(value)) throw new Error('Значение должно быть кратно 0,25 м');
  return value;
}
