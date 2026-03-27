function sumAll(numbers) {
  return numbers.reduce((acc, current) => acc + current, 0);
}

function calculateAverage(numbers) {
  if (numbers.length === 0) return 0;
  return sumAll(numbers) / numbers.length;
}

module.exports = { sumAll, calculateAverage };
