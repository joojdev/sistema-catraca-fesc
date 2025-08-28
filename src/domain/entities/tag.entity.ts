export default class Tag {
  constructor(
    public userId: number,
    public credential: number,
    public released: boolean,
    public status: string,
    public admin: boolean,
  ) {}
}
