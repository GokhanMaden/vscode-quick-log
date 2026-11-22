function getName(user: User) {
  const name = user.firstName;
  console.log("name:", name)
  return name.trim();
}
