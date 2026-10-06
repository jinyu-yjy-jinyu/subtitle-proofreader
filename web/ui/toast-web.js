/** Web build: toast and modal helpers (no ffmpeg dialogs). */

const host = document.getElementById('toast-host');

export function toast(title, detail = '', kind = 'info', timeout = 3600) {
  const el = document.createElement('div');
  el.className = `toast is-${kind}`;

  const t = document.createElement('div');
  t.className = 'toast-title';
  t.textContent = title;
  el.appendChild(t);

  if (detail) {
    const d = document.createElement('div');
    d.className = 'toast-detail';
    d.textContent = detail;
    el.appendChild(d);
  }

  host.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .2s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 220);
  }, timeout);
  return el;
}

const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
const modalActions = document.getElementById('modal-actions');

export function showModal({ title, body, actions }) {
  return new Promise((resolve) => {
    modalTitle.textContent = title;
    modalBody.innerHTML = '';
    if (typeof body === 'string') modalBody.innerHTML = body;
    else if (body) modalBody.appendChild(body);
    modalActions.innerHTML = '';

    const cleanup = () => {
      modal.removeEventListener('cancel', onCancel);
      modal.removeEventListener('close', onClose);
    };
    const finish = (value) => {
      cleanup();
      if (modal.open) modal.close();
      modalActions.innerHTML = '';
      resolve(value);
    };
    const onCancel = (e) => {
      e.preventDefault();
      finish(null);
    };
    const onClose = () => {
      cleanup();
      modalActions.innerHTML = '';
      resolve(null);
    };

    modal.addEventListener('cancel', onCancel);
    modal.addEventListener('close', onClose);

    for (const action of actions) {
      const btn = document.createElement('button');
      btn.className = 'btn' + (action.primary || action.variant === 'primary' ? ' btn-primary' : '');
      if (action.variant === 'danger') btn.classList.add('btn-danger');
      btn.textContent = action.label;
      btn.addEventListener('click', () => finish(action.value));
      modalActions.appendChild(btn);
    }

    modal.showModal();
  });
}

export function confirmDialog({ title, message, okLabel = '确定', cancelLabel = '取消', danger = false }) {
  const body = document.createElement('div');
  const p = document.createElement('p');
  p.textContent = message;
  body.appendChild(p);

  return showModal({
    title,
    body,
    actions: [
      { label: cancelLabel, value: false },
      { label: okLabel, value: true, variant: danger ? 'danger' : 'primary' },
    ],
  }).then((v) => v === true);
}

export function showIssues(summary, issues) {
  const body = document.createElement('div');
  const head = document.createElement('p');
  head.textContent =
    `共 ${summary.count} 条，时间范围 ${summary.firstStart} → ${summary.lastEnd}` +
    (summary.errors ? `，${summary.errors} 个错误` : '') +
    (summary.warnings ? `，${summary.warnings} 个警告` : '');
  body.appendChild(head);

  const ul = document.createElement('ul');
  ul.className = 'modal-issues';
  for (const issue of issues) {
    const li = document.createElement('li');
    li.className = `sev-${issue.severity}`;
    const label =
      issue.severity === 'error' ? '错误' : issue.severity === 'warning' ? '警告' : '提示';
    li.textContent = `${label}：${issue.message}`;
    ul.appendChild(li);
  }
  body.appendChild(ul);

  return showModal({
    title: '格式校验结果',
    body,
    actions: [{ label: '关闭', value: true, variant: 'primary' }],
  });
}