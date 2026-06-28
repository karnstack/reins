// reins popup — M0 stub. M1 adds pairing form, connection indicator, kill switch.
export {};

const status = document.getElementById("status");
if (status) {
  status.textContent = "Not paired (M1)";
}
