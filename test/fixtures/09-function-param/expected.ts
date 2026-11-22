function save(user: User) {
  console.log("user:", user)
  db.write(user);
}
