export type VirtualDisk = {
  driveLetter: string;
  volumeName: string;
  fileSystem: string;
  totalSpace: number;
  freeSpace: number;
};

export type PhysicalDisk = {
  index: number;
  model: string;
  size: number;
  mediaType: string;
  interfaceType: string;
  volumes: VirtualDisk[];
};
