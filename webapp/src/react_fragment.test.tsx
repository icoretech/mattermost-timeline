function generateSomething() {
  return <div>{"something"}</div>;
}

test("Can test React fragments", () => {
  expect(generateSomething()).toBeDefined();
});
