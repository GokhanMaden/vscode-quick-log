const { data, error } = useQuery(() => {
  return fetchUser();
});
console.log("data:", data)
